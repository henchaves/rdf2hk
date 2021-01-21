/*
 * copyright: IBM Confidential
 * copyright: OCO Source Materials
 * copyright: © IBM Corp. All Rights Reserved
 * date: 2020
 *
 * IBM Certificate of Originality
 */
"use strict";


const SparqlJS = require("sparqljs");

const BOOLEAN_XSD_URI = "http://www.w3.org/2001/XMLSchema#boolean";

const HKUris = require("rdf2hk/hk");

function traverseValues(values, out)
{
	for(let k in values)
	{
		let entry = values[k]

		for(let j in entry)
		{
			let v = entry[j];

			if(v.termType === "Literal") // Workaround to this bug: https://github.com/RubenVerborgh/SPARQL.js/issues/92
			{
				if(v.datatypeString === BOOLEAN_XSD_URI)
				{
					entry[j] = new v.constructor(`"${v.value.toLowerCase()}"^^${v.datatypeString}`);
				}
			}
		}
	}
}

function traverseBGP(triples, out, state)
{
	for(let i = 0; i < triples.length; i++)
	{
		let t = triples[i];

		if(!state.skipBgp)
		{
			if(t.subject.termType === "Variable")
			{
				out.subjects.add(t.subject.value)
			}
			if(t.predicate.termType === "Variable")
			{
				out.predicates.add(t.predicate.value)
			}
			if(t.object.termType === "Variable")
			{
				out.objects.add(t.object.value);
			}
		}

		if(t.object.termType === "Literal") // Workaround to this bug: https://github.com/RubenVerborgh/SPARQL.js/issues/92
		{
			if(t.object.datatypeString === BOOLEAN_XSD_URI)
			{
				t.object = new t.object.constructor(`"${t.object.value.toLowerCase()}"^^${t.object.datatypeString}`);
			}
		}

		// console.log(t);
	}

}

function traverseOperation(operation, out)
{
	for(let i = 0; i < operation.args.length; i++)
	{
		let o = operation.args[i];

		if(o.termType)
		{
			if(o.termType === "Literal")
			{
				if(o.datatypeString === BOOLEAN_XSD_URI)
				{
					operation.args[i] = new o.constructor(`"${o.value.toLowerCase()}"^^${o.datatypeString}`);
				}
			}
		}
		else if(o.type === "expression")
		{
			traverseExpression(o, out);
		}
		else if(o.type === "operation")
		{
			traverseOperation(o, out);
		}
	}
}

function traverseExpression(expression, out)
{
	if(expression.type === "operation")
	{
		traverseOperation(expression, out)
	}
}

function traverseFilter(filter, out)
{
	if(filter.expression)
	{
		traverseExpression(filter.expression, out);
	}
}

function traverseGraph(graph, out)
{
	if(graph.name)
	{
		out.graphs.add(graph.name.value);
	}
}

function generalTraverse(parts, out, state)
{
	for(let i = 0; i < parts.length; i++)
	{
		let n = parts[i];

		// console.log(n);

		switch(n.type)
		{
			case "bgp":
				traverseBGP(n.triples, out, state);
				break;
			case "graph":
				traverseGraph(n, out, state);
			case "group":
				generalTraverse(n.patterns, out, state);
				break;
			case "query":
				traverseQuery(n, out, state)
				break;
			case "filter":
				traverseFilter(n, out, state);
				break;
			case "optional":
				// console.log(n);
				generalTraverse(n.patterns, out, {skipBgp: true});
				break;
			case "bind":
				break;
			case "union":
				generalTraverse(n.patterns, out, state)
				break;
			case "values":
				traverseValues(n.values, out, state);
				break;
			default:
				console.log("Unknown term?", n.type);
				break;

		}
	}
}

function traverseQuery(query, out, state)
{
	state = state || {skipBgp: false};
	out.queries.push(query);
	let parts = query.where;


	generalTraverse(parts, out, state);
}

function setHKFiltered(query)
{
	try
	{
		let sparqlParser = new SparqlJS.Parser();
		let sparqlGenerator = new SparqlJS.Generator();

		let sparqlObj = sparqlParser.parse(query);

		let filteredSparqlParser = new SparqlJS.Parser();

		let out = {subjects: new Set(),
				  predicates: new Set(),
				  objects: new Set(),
				  graphs: new Set(),
				  queries: []};

		// console.log(sparqlObj);

		traverseQuery(sparqlObj, out);

		for(let i = 0; i < out.queries.length; i++)
		{
			let query = out.queries[i];

			let queryTraversal = {subjects: new Set(),
				predicates: new Set(),
				objects: new Set(),
				graphs: new Set(),
				queries: []};

			traverseQuery(query, queryTraversal);

			// console.log(queryTraversal);
			// console.log(queryTraversal.predicates);

			let temp = {filters: ""}

			let subjects = Array.from(queryTraversal.subjects);

			let predicates = Array.from(queryTraversal.predicates);

			let objects = Array.from(queryTraversal.objects);

			let graphs = Array.from(queryTraversal.graphs);

			if(subjects.length === 0 && predicates.length === 0 && objects.length === 0 && graphs.length === 0)
			{
				continue;
			}

			let first = false;

			// add filters for graph variables. 
			// Only works properly if triples are not imported in hk://id/null
			// for(let i = 0; i < graphs.length; i++)
			// {
			// 	let v = graphs[i];
			// 	variables += `?${v} `;

			// 	if( first )
			// 	{
			// 		temp.filters += " && ";
			// 	}
			// 	filterGraphsForHK(v, temp);
			// 	first = true;
			// }

			let variables = new Set();

			for(let i = 0; i < subjects.length; i++)
			{
				let v = subjects[i];
				variables.add(`?${v}`);

				if( first )
				{
					temp.filters += " && ";
				}
				filterSubjectsForHK(v, temp);
				first = true;
			}

			// add filters for predicate variables
			for(let i = 0; i < predicates.length; i++)
			{
				let v = predicates[i];
				variables.add(`?${v}`);

				if( first )
				{
					temp.filters += " && ";
				}
				filterPredicatesForHK(v, temp);
				first = true;
			}

			// add filters for object variables
			for(let i = 0; i < objects.length; i++)
			{
				let v = objects[i];
				variables.add(`?${v}`);

				if( first )
				{
					temp.filters += " && ";
				}
				filterObjectsForHK(v, temp);
				first = true;
			}


			let filteredQuery = `select ${[...variables].join(' ')} where { filter(${temp.filters}) }`;

			let filteredQueryObject = filteredSparqlParser.parse(filteredQuery);

			query.where = query.where.concat(filteredQueryObject.where);
		}

		/**
		 * Workaround to remove brackets that are automatically added by sparqljs lib in the group by clause.
		 * This is necessary because triplestores such as Allegrograph do not support queries with round brackets in the group by clause.
		 * E.g.: from group by (?x) to group by ?x 
		 * 
		 * Remove this workaround in case the issue #127 (https://github.com/RubenVerborgh/SPARQL.js/issues/127) is solved.
		 */

		let groupByResolver = (sparqlObj) => {
			if(sparqlObj.group)
			{
				if(sparqlObj.group.length > 0)
				{
					for(let g of sparqlObj.group )
					{
						if(g.expression.termType === "Variable" )
						{
							g.expression = `?${g.expression.value}`;
						}
					}
				}
			}

			if(sparqlObj.where)
			{
				for(let where of sparqlObj.where)
				{
					if(where.patterns)
					{
						where.patterns.forEach(p => 
						{
							groupByResolver(p);
						})
					}	
				}
			}
			else if (sparqlObj.type === 'group')
			{
				if(sparqlObj.patterns)
				{
					sparqlObj.patterns.forEach(p => 
					{
						groupByResolver(p);
					})
				}
			}
		};

		groupByResolver(sparqlObj);

		return sparqlGenerator.stringify(sparqlObj);

	}
	catch(exp)
	{
		console.log(exp);
		console.log("Warning: Failed to parse query to inject filters. Skipped.");
		// console.log(query);
		return query;
	}

}

function filterPredicatesForHK (variable, filters)
{
	if(!variable.startsWith("?"))
	{
		variable = "?" + variable;
	}
	filters.filters += `(
		!BOUND(${variable}) || 
		(
			${variable} != ${HKUris.ISA_URI} &&
			${variable} != ${HKUris.USES_CONNECTOR_URI}  &&
			${variable} != ${HKUris.CLASSNAME_URI} &&
			${variable} != ${HKUris.REFERENCES_URI} &&
			${variable} != ${HKUris.HAS_PARENT_URI} &&
			!STRSTARTS(STR(${variable}), "hk://role") &&
			!STRSTARTS(STR(${variable}), "hk://b/") &&
			!STRSTARTS(STR(${variable}), "hk://link")
		)
	)`;
}

function filterSubjectsForHK (variable, filters)
{
	if(!variable.startsWith("?"))
	{
		variable = "?" + variable;
	}
	const reservedURIFilters = `(${variable} != ${HKUris.ISA_URI} &&
								${variable} != ${HKUris.USES_CONNECTOR_URI}  &&
								${variable} != ${HKUris.CLASSNAME_URI} &&
								${variable} != ${HKUris.REFERENCES_URI} &&
								${variable} != ${HKUris.HAS_PARENT_URI} )`;
	const stringBasedFilters =  `!( ISIRI(${variable}) && ( STRSTARTS(STR(${variable}), "hk://role") || STRSTARTS(STR(${variable}), "hk://link") || STRSTARTS(STR(${variable}), "hk://b/") ) )`;
	const functionBasedFilters = `( isIRI(${variable}) || isBlank(${variable}) ||  datatype(${variable}) != ${HKUris.DATA_LIST_URI} )`;
	filters.filters += `(
		!BOUND(${variable}) ||
		( 
			${reservedURIFilters} && ${stringBasedFilters} && ${functionBasedFilters} 
		)
	)`;
}

function filterObjectsForHK (variable, filters)
{
	if(!variable.startsWith("?"))
	{
		variable = "?" + variable;
	}
	const stringBasedFilters =  `!( ISIRI(${variable}) && ( STRSTARTS(STR(${variable}), "hk://role") || STRSTARTS(STR(${variable}), "hk://link") || STRSTARTS(STR(${variable}), "hk://b/") ) )`;
	const functionBasedFilters = `( isIRI(${variable}) || isBlank(${variable}) ||  datatype(${variable}) != ${HKUris.DATA_LIST_URI} )`;
	filters.filters += `(
		!BOUND(${variable}) ||
		( 
			${stringBasedFilters} && ${functionBasedFilters} 
		)
	)`;
}

function optimizeFilter (filters)
{
	let out = [];

	let clusters = {};

	let addPairToCluster = (key)=>
	{
		if(!clusters.hasOwnProperty(key))
		{
			clusters[key] = 1;
		}
		else
		{
			clusters[key] = clusters[key] + 1;;	
		}
	}

	let getHashes = (andFilters) =>
	{
		let hashes = [];

		for(let j = 0; j < andFilters.length; j++)
		{
			let constraint = andFilters[j];

			for(let k in constraint)
			{
				let v = constraint[k];

				if(typeof v === "object")
				{
					for(let i in v)
					{
						let pair = `${k}.${i}=${v[i]}`;
						hashes.push(pair);
					}
				}
				else
				{
					let pair = `${k}=${v}`;
					hashes.push(pair);
				}
			}

		}

		return hashes;
	}

	for(let i = 0; i < filters.length; i++)
	{
		let andFilters = filters[i];

		let hashes = getHashes(andFilters);
		for(let h of hashes)
		{
			addPairToCluster(h);
		}
		out.push(andFilters);
	}


	filters.sort((a, b) =>
	{
		let hashesA = getHashes(a);
		let hashesB = getHashes(b);

		if(hashesA.length < hashesB.length)
		{
			return -1;
		}
		else if(hashesA.length > hashesB.length)
		{
			return 1;
		}
		else
		{
			let aCounts = [];
			for(let i = 0; i < hashesA.length; i++)
			{
				aCounts.push(clusters[hashesA[i]]);
			}
			let bCounts = [];
			for(let i = 0; i < hashesB.length; i++)
			{
				bCounts.push(clusters[hashesA[i]]);
			}

			aCounts.sort();
			bCounts.sort();

			let ka = aCounts.join("_");
			let kb = bCounts.join("_");

			if(ka < kb)
			{
				return -1;
			}
			else if(kb < ka)
			{
				return -1;
			}
			else 
			{	
				hashesA.sort();
				hashesB.sort();

				let ha = hashesA.join(";");
				let hb = hashesB.join(";");

				if(ha < hb)
				{
					return -1;
				}
				else if(ha > hb)
				{
					return 1;
				}
				return 0;
			}


		}

	});

	let optimized = [];

	// console.log(">>>>>>>");
	// console.log(JSON.stringify(filters, null, 2));

	let last = filters[0];

	let willBreak = false;
	for(let i = 1; i < filters.length; i++)
	{
		let item = filters[i];


		let pendingValue = null;
		let pendingKey = null;
		let pendingProperty = null;
		let foundWildcard = false;
		for(let i = 0 ; i < item.length; i++)
		{
			let c1 = item[i];

			for(let k in c1)
			{
				for(let j = 0; j < last.length; j++)
				{
					let c2 = last[j];


					if(c2.hasOwnProperty(k))
					{
						if(Array.isArray(c2[k]))
						{
							if(!foundWildcard)
							{
								foundWildcard = true;
								pendingValue = c1[k];
								pendingKey = k;
								pendingProperty = c2;
							}
							else
							{
								optimized.push(last);
								last = item;
								willBreak = true;
								break;
							}
						}
						else if(typeof c2[k] === "object" && typeof c1[k] === "object")
						{
							let v1 = c1[k];
							let v2 = c2[k];

							for(let x in v1)
							{
								if(Array.isArray(v2[x]))
								{
									if(!foundWildcard)
									{
										foundWildcard = true;
										pendingValue = v1[x];
										pendingKey = x;
										pendingProperty = v2;
									}
									else
									{
										optimized.push(last);
										last = item;
										willBreak = true;
										break;
									}
								}
								else if(v2.hasOwnProperty(x))
								{
									if(v1[x] !== v2[x])
									{
										if(!foundWildcard)
										{
											foundWildcard = true;
											pendingValue = v1[x];
											pendingKey = x;
											pendingProperty = v2;
										}
										else
										{
											optimized.push(last);
											last = item;
											willBreak = true;
											break;
										}
									}
									
								}
								else
								{
									optimized.push(last);
									last = item;
									willBreak = true;
									break;
								}
							}
						}
						else
						{
							if(c1[k] !== c2[k])
							{
								if(foundWildcard)
								{
									optimized.push(last);
									last = item;
									willBreak = true;
									break;
								}
								else
								{
									pendingValue = c1[k];
									pendingKey = k;
									pendingProperty = c2;
									foundWildcard = true;
								}
							}
						}
					}
					else
					{
						optimized.push(last);
						last = item;
						willBreak = true;
						break;
					}
				}

				if(willBreak)
				{
					break;
				}
			}
			if(willBreak)
			{
				break;
			}
		}

		if(!willBreak && pendingValue && pendingProperty && pendingKey)
		{
			if(!Array.isArray(pendingProperty[pendingKey]))
			{
				pendingProperty[pendingKey] = [pendingProperty[pendingKey]];
			}

			pendingProperty[pendingKey].push(pendingValue);
		}
		willBreak = false;

	}
	optimized.push(last);

	// console.log(JSON.stringify(clusters, null, 2));

	
	// console.log("*******");
	// console.log(JSON.stringify(optimized, null, 2));

	// console.log("results", filters.length, optimized.length);
	return optimized;
}

function optimizeFilter2 (filters)
{
	const clusters          = {};
	const bindClusters      = {};
	const bindConnClusters  = {};

	let out = [];

	let map = {};

	let bindsArray = [];

	for(let i = 0; i < filters.length; i++)
	{
		let andFilters = filters[i];

		let currentConstraint = [];
		

		if(andFilters.length === 1)
		{
			for(let j = 0; j < andFilters.length; j++)
			{
				let constraint = andFilters[j];

				let keys = Object.keys(constraint);

				// if(constraint.binds || constraint.connector)
				// {
				// 	for(let k in constraint)
				// 	{
				// 		let v = constraint[k];

				// 		if(k === "binds")
				// 		{
				// 			for(let b in v)
				// 			{
				// 				let pair = `binds=${b}_${v[b]}`;
				// 				if(!map.hasOwnProperty(pair))
				// 				{
				// 					map[pair] = 1;
				// 				}	
				// 				else
				// 				{
				// 					map[pair] = map[pair] +1;
				// 				}
				// 			}
				// 		}
				// 		else
				// 		{
				// 			let pair = `${k}=${v}`;
				// 			if(!map.hasOwnProperty(pair))
				// 			{
				// 				map[pair] = 1;
				// 			}	
				// 			else
				// 			{
				// 				map[pair] = map[pair] +1;
				// 			}
				// 		}
				// 	}

				// 	bindsArray.push(constraint);

				// }
				if(keys.length === 2)
				{
					if(constraint.binds && constraint.connector && Object.keys(constraint.binds).length === 1)
					{
						if(!bindConnClusters.hasOwnProperty(constraint.connector))
						{
							bindConnClusters[constraint.connector] = {};
						}

						let role = Object.keys(constraint.binds)[0];
						let binds = bindConnClusters[constraint.connector];
						
						if(!binds.hasOwnProperty(role))
						{
							binds[role] = new Set();
						}
						binds[role].add(constraint.binds[role]);
					}
					else
					{
						currentConstraint.push(constraint);	
					}
				}
				else 
				if(keys.length === 1)
				{
					let k = keys[0];
					let v = constraint[k];
					switch(k)
					{
						case "parent":
						case "ref":
						case "id":
						case "connector":
							if(!clusters.hasOwnProperty(k))
							{
								clusters[k] = new Set();
							}
							clusters[k].add(v);
						break;
						case "binds":
							let role = Object.keys(constraint[k])[0];
							if(!bindClusters.hasOwnProperty(role))
							{
								bindClusters[role] = new Set();
							}
							bindClusters[role].add(v[role]);

							break;
						default:
							// out.push([constraint]);
							currentConstraint.push(constraint);
						break;

					}
				}
				else
				{
					// out.push([constraint]);
					currentConstraint.push(constraint);
				}
			}
			if(currentConstraint.length > 0)
			{
				out.push(currentConstraint);
			}
		}
		else
		{
			out.push(andFilters);
		}
	}

	// console.log(map);

	// bindsArray.sort((a, b) =>
	// {
	// 	let a1 = [];
	// 	for(let k in a)
	// 	{
	// 		if(k === "binds")
	// 		{
	// 			for(let b in v)
	// 			{
	// 				let pair = `binds=${b}_${v[b]}`;
	// 				a1.push(map[pair]);
	// 			}
	// 		}
	// 		else
	// 		{
	// 			let pair = `${k}=${v}`;
	// 			a1.push(pair);
	// 		}
	// 	}	
	// 	let b1 = [];
	// 	for(let k in b)
	// 	{
	// 		if(k === "binds")
	// 		{
	// 			for(let b in v)
	// 			{
	// 				let pair = `binds=${b}_${v[b]}`;
	// 				b1.push(pair);
	// 			}
	// 		}
	// 		else
	// 		{
	// 			let pair = `${k}=${v}`;
	// 			b1.push(pair);
	// 		}
	// 	};

	// 	let out = 0;
	// 	for(let i of a1)
	// 	{
	// 		for(let j of b1)
	// 		{

	// 		}
	// 	}
	// })

	if(Object.keys(clusters).length > 0)
	{
		for(let k in clusters)
		{
			let optimized = {}
			optimized[k] = Array.from(clusters[k]);
			out.push([optimized]);
		}
	}

	if(Object.keys(bindClusters).length > 0)
	{
		for(let k in bindClusters)
		{
			let optimized = {binds: {}};
			optimized.binds[k] = Array.from(bindClusters[k]);
			out.push([optimized]);
		}
	}

	if(Object.keys(bindConnClusters).length > 0)
	{
		for(let k in bindConnClusters)
		{
			let binds = bindConnClusters[k];

			for(let role in binds)
			{
				let optimized = {connector: k, binds: {}};
				optimized.binds[role] = Array.from(binds[role]);
				out.push([optimized]);
			}
		}
	}

	return out;
}

exports.optimizeFilter  = optimizeFilter;
exports.filterForHK = filterPredicatesForHK;
exports.setHKFiltered = setHKFiltered;