/*
 * Copyright (c) 2016-present, IBM Research
 * Licensed under The MIT License [see LICENSE for details]
 */
"use strict";

const HKLib				= require("hklib");
const Node 				= HKLib.Node;
const Trail 			= HKLib.Trail;
const Connector 		= HKLib.Connector;
const Link 				= HKLib.Link;
const Context 			= HKLib.Context;
const ConnectorClass 	= HKLib.ConnectorClass;
const Reference 		= HKLib.Reference;
const RoleTypes 		= HKLib.RolesTypes;

const Constants 		= require("./constants");
const Utils 			= require("./utils");

const owl 				= require("./owl");
const rdfs 				= require("./rdfs");
const xml 				= require("./xmlschema");
const skos 				= require("./skos");
const foaf 				= require("./foaf");
const dcterms 			= require("./dcterms");
const hk 				= require("./hk");

const uuidv1 			= require('uuid/v1');


// Sub Parsers
const OWLParser = require("./simpleowlparser");
const HKParser = require("./hkparser");

const RELATION_QUALIFIER_URIS = new Set();
RELATION_QUALIFIER_URIS.add(owl.INVERSE_OF_URI);
RELATION_QUALIFIER_URIS.add(rdfs.SUBPROPERTYOF_URI);


const isUriOrBlankNode = Utils.isUriOrBlankNode;

/**
 * @deprecated This method will be deleted in next vesions. Use parseGraph instead.
 * Parse rdf triples to Hyperknowledge entities
 * 
 * @param {Array} triples The triples (quads, if it contains named graph) to be parsed and converted to Hyperknowledge entities. It can be a vector of vector or a vector of rdflib.js statements.
 * @param {boolean|object} [options] Parsing options, if it is a boolean, is equivalent to {createContext: true} which means it will generate context for each named graph.
 * @param {boolean} [options.createContext] Create the context entity for each named graph. Default is false.
 * @param {boolean} [options.subjectLabel] Set the subject role name `subject`
 * @param {boolean} [options.objectLabel] Set the object role name `object`
 * @param {boolean} [options.convertOwl] EXPERIMENTAL OWL rules. Default is false.
 * @param {boolean} [options.preserveBlankNodes] Preserve the blank node ids if true, otherwise replace it by a uuid inteded to be unique in the database. Default is false.
 * @param {boolean} [options.serialize] Serialize output, i. e. remove unnecessary methods and fields from the intances.
 * @param {boolean} [options.convertHK] If set, it will read the Hyperknowledge vocabulary and make special conversion. Default is true.
 * @param {boolean} [options.onlyHK] If set, it will ONLY read the Hyperknowledge vocabulary and convert those entities, this options override `convertHK`. Default is false.
 */

function parseGraph(graph, options)
{
	if (typeof options === "boolean")
	{
		options = {
			createContext: options
		};
	}
	else if (typeof options === Array)
	{
		// options = {ids: options};
	}
	else if (!options)
	{
		options = {};
	}

	let createContext = options.createContext || false;

	const preserveBlankNodes = options.preserveBlankNodes || false;

	let convertOwl = options.convertOwl || false;

	let setNodeContext = options.setNodeContext && true;

	let convertHK = options.convertHK && true;

	let onlyHK = options.onlyHK || false;

	convertHK = convertHK || onlyHK;

	let serialize = options.serialize || false;

	const subjectLabel = options.subjectLabel || Constants.DEFAULT_SUBJECT_ROLE;
	const objectLabel = options.objectLabel || Constants.DEFAULT_OBJECT_ROLE;

	let entities = {};
	let connectors = {};

	let blankNodesMap = {};
	let referencedBlankNode = {};

	let owlParser = new OWLParser(entities, options);

	let hkParser = new HKParser(entities, blankNodesMap, onlyHK);

	let createReference = (s, g) =>
	{
		let ref = new Reference();

		ref.id = Utils.createRefUri(s, g);
		ref.ref = s;
		ref.parent = g || null;

		entities[ref.id] = ref;

		return ref;
	}


	// FIRST LOOP
	// Collect basic connectors
	// Collect contexts
	graph.forEachStatement((s, p, o, g) =>
	{
		if (convertHK && hkParser.shouldConvert(s, p, o, g))
		{
			hkParser.createEntities(s, p, o, g);
			return;
		}
		else if (convertOwl && owlParser.shouldConvert(s, p, o, g))
		{
			owlParser.createConnectors(s, p, o, g);
			return;
		}
		// Create connector?

		if (Utils.isUri(p) && Utils.isUriOrBlankNode(o))
		{
			let connector = new Connector();
			connector.id = Utils.getIdFromResource(p);
			connector.className = p === rdfs.TYPE_URI ? ConnectorClass.HIERARCHY : ConnectorClass.FACTS;
			connector.addRole(subjectLabel, RoleTypes.SUBJECT);
			connector.addRole(objectLabel, RoleTypes.OBJECT);
			connectors[connector.id] = connector;
			entities[connector.id] = connector;
		}

		if (createContext && g)
		{
			// Create context
			if (!entities.hasOwnProperty(g))
			{
				let context = new Context();
				context.id = g;
				entities[g] = context;
			}
		}
	});

	// SECOND LOOP
	// Create nodes
	graph.forEachStatement((s, p, o, g) =>
	{
		// console.log(s, p, o);
		// Replace the blank node identitier to uuid
		// In order to make this id more robust along the base
		if (!preserveBlankNodes)
		{
			if (Utils.isBlankNode(s) && !blankNodesMap.hasOwnProperty(s))
			{
				blankNodesMap[s] = `_:${uuidv1()}`;
			}

			if (Utils.isBlankNode(o) && !blankNodesMap.hasOwnProperty(o))
			{
				blankNodesMap[o] = `_:${uuidv1()}`;
			}
		}

		if (onlyHK || (convertHK && hkParser.shouldConvert(s, p, o, g)))
		{
			return;
		}
		else if (convertOwl && owlParser.shouldConvert(s, p, o, g))
		{
			return;
		}

		let subjectId = Utils.getIdFromResource(s);
		if ( isUriOrBlankNode(s) && !entities.hasOwnProperty(subjectId))
		{
			let node = new Node();
			node.id = blankNodesMap.hasOwnProperty(s) ? blankNodesMap[s] : subjectId;
			entities[node.id] = node;

			// Set the context to the graph name
			if (setNodeContext && g)
			{
				node.parent = Utils.getIdFromResource(g);
			}
		}

		let objectId = Utils.getIdFromResource(o);
		if ( isUriOrBlankNode(o) && !entities.hasOwnProperty(objectId))
		{
			let node = new Node();
			node.id = blankNodesMap.hasOwnProperty(o) ? blankNodesMap[o] : objectId;
			entities[node.id] = node;

			// Set the context to the graph name
			if (setNodeContext && g)
			{
				node.parent = Utils.getIdFromResource(g);
			}
		}

	});

	// LAST LOOP
	// Create attributes and relations and ref nodes if need
	graph.forEachStatement((s, p, o, g) =>
	{
		if (convertHK && hkParser.shouldConvert(s, p, o, g))
		{
			hkParser.setIntrisecsProperties(s, p, o, g);
			return;
		}
		else if (convertOwl && owlParser.shouldConvert(s, p, o, g))
		{
			owlParser.createRelationships(s, p, o, g);
			return;
		}

		// Set relationship
		if (isUriOrBlankNode(o))
		{
			let connectorId = Utils.getIdFromResource(p);
			if (connectors.hasOwnProperty(connectorId))
			{
				let connector = connectors[connectorId];
				let link = new Link();

				let roles = connector.getRoles();

				for (let i = 0; i < roles.length; i++)
				{
					let r = roles[i];

					let roleType = connector.getRoleType(r);
					if (roleType === RoleTypes.SUBJECT || roleType === RoleTypes.CHILD)
					{
						let subjId = blankNodesMap.hasOwnProperty(s) ? blankNodesMap[s] : s;
						subjId = Utils.getIdFromResource(subjId);
						link.addBind(subjectLabel, subjId);
					}
					else if (roleType === RoleTypes.OBJECT || roleType === RoleTypes.PARENT)
					{
						let objId = blankNodesMap.hasOwnProperty(o) ? blankNodesMap[o] : o;
						objId = Utils.getIdFromResource(objId);
						link.addBind(objectLabel, objId);
					}
				}

				// console.log(s, p, o);
				link.id = Utils.createSpoUri(s, p, o, g);

				link.connector = connectorId;
				if (g)
				{
					link.parent = Utils.getIdFromResource(g);
				}
				entities[link.id] = link;
			}
		}
		else
		{
			// Set Entity properties

			// Define the entity to bind the property
			let node = null;

			// Get maped blank node
			if (!preserveBlankNodes && blankNodesMap.hasOwnProperty(s))
			{
				s = blankNodesMap[s];
			}
			let subjectId = Utils.getIdFromResource(s);

			if (!Utils.getIdFromResource(g))
			{
				node = entities[subjectId]; // we assume the entity must have been created
			}
			else
			{
				node = entities[subjectId] || null;

				if(node !== null)
				{
					if (node.type !== Connector.type && node.parent !== Utils.getIdFromResource(g))
					{
						// The node already exists and it belongs to another context
						// This assign will force to look for a reference node
						node = null;
					}
				}

				// Check if there is a reference to the resource
				if (!node)
				{
					let refId = Utils.createRefUri(s, g);

					node = entities[refId] || null;
				}
			}

			// If at this point the entity was not set
			// create a reference to it
			if (!node)
			{
				if (onlyHK)
				{
					// Do not create entities by inference
					// when conversion is to only convert
					// hyperknowledge entities
					return;
				}
				node = createReference(s, g);
			}

			// Convert the literal
			_setPropertyFromLiteral(node, p, o);
		}

	});

	// Finish conversion

	// Add connectors
	for (let c in connectors)
	{
		entities[c] = connectors[c];
	}

	if (convertHK)
	{
		hkParser.finish(entities);
	}

	if (convertOwl)
	{
		owlParser.finish(entities);
	}

	// Serialize entities
	if (serialize)
	{
		for (let k in entities)
		{
			entities[k] = entities[k].serialize();
		}
	}

	return entities;
}

function _setPropertyFromLiteral(node, p, o)
{
	let typeInfo = {};
	let value = Utils.getValueFromLiteral(o, typeInfo, true);

	if(typeof value === "string")
	{
		let literalSlices = value.split(`^^`);
		if (literalSlices[0] === `"<${Constants.HK_NULL}>"`)
		{
			if (literalSlices[1] !== null)
			{
				node.setMetaProperty(Utils.getIdFromResource(p), Utils.getIdFromResource(literalSlices[1]));
			}
			return;
		}
	}


	let propertyName = Utils.getIdFromResource(p);

	if (typeInfo.lang)
	{
		node.setOrAppendToProperty(propertyName, `"${value}"@${typeInfo.lang}`);
	}
	else
	{
		node.setOrAppendToProperty(propertyName, value);
	}

	if (typeInfo.type && typeInfo.type !== xml.STRING_URI)
	{
		node.setMetaProperty(propertyName, Utils.getIdFromResource(typeInfo.type));
	}
}


// exports.parseTriples = parseTriples;
exports.parseGraph = parseGraph;