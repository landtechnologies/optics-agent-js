/* eslint-disable */
// This code taken and modified from:
// https://raw.githubusercontent.com/graphql/graphql-js/3142d872af011daec8be83c3a88d014f47ee0c64/src/language/printer.js
// according to the term of the BSD-style license provided there and copied below
//
// This file has been modified to print a "normalized" version of the
// query instead of the full version.
//
// See https://github.com/apollostack/optics-agent/blob/master/docs/signatures.md

/**
 *  Copyright (c) 2015, Facebook, Inc.
 *  All rights reserved.
 *
 *  This source code is licensed under the BSD-style license found in the
 *  LICENSE file in the root directory of this source tree. An additional grant
 *  of patent rights can be found in the PATENTS file in the same directory.
 */



import { visit } from 'graphql/language';

/**
 * Converts an AST into a string, using one set of reasonable
 * formatting rules.
 */
export function print(ast) {
  return visit(ast, { leave: printDocASTReducer });
}


// Define an ordering for field names in a printed result.
// Fields first, then fragment spreads, then inline fragements.
// Alphabetical within that.
// See https://github.com/apollostack/optics-agent/blob/master/docs/signatures.md
// for full details
function nameOrder (a) {
  if (a.substring(0,4) === "... ") {
    return 2;
  }
  if (a.substring(0,3) === "...") {
    return 1;
  }
  return 0;
}
function compareFieldNames(a, b) {
  const aOrder = nameOrder(a);
  const bOrder = nameOrder(b);
  if (aOrder < bOrder) {
    return -1;
  }
  if (aOrder > bOrder) {
    return 1;
  }
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

const printDocASTReducer = {
  Name: node => node.value,
  Variable: node => '$' + node.name,

  // Document

  Document: node => join(node.definitions, ' '),

  OperationDefinition(node) {
    const op = node.operation;
    const name = node.name;
    const varDefs = wrap('(', join(node.variableDefinitions && node.variableDefinitions.slice().sort(), ','), ')');
    const directives = join(node.directives, ' ');
    const selectionSet = node.selectionSet;
    // Anonymous queries with no directives or variable definitions can use
    // the query short form.
    return !name && !directives && !varDefs && op === 'query' ?
      selectionSet :
      join([ op, join([ name, varDefs ]), directives, selectionSet ], ' ');
  },

  VariableDefinition: ({ variable, type, defaultValue }) =>
    variable + ':' + type + wrap(' = ', defaultValue),

  SelectionSet: ({ selections }) => block(selections && selections.slice().sort(compareFieldNames)),

  Field: ({ alias, name, arguments: args, directives, selectionSet }) =>
    join([
      /* wrap('', alias, ':') + */ name + wrap('(', join(args && args.slice().sort(), ', '), ')'),
      join(directives, ' '),
      selectionSet
    ], ' '),

  Argument: ({ name, value }) => name + ':' + value,

  // Fragments

  FragmentSpread: ({ name, directives }) =>
    '...' + name + wrap(' ', join(directives && directives.slice().sort(), ' ')),

  InlineFragment: ({ typeCondition, directives, selectionSet }) =>
    join([
      '...',
      wrap('on ', typeCondition),
      join(directives && directives.slice().sort(), ' '),
      selectionSet
    ], ' '),

  FragmentDefinition: ({ name, typeCondition, directives, selectionSet }) =>
    `fragment ${name} on ${typeCondition} ` +
    wrap('', join(directives && directives.slice().sort(), ' '), ' ') +
    selectionSet,

  // Value

  IntValue: ({ value }) => 0,
  FloatValue: ({ value }) => 0,
  StringValue: ({ value }) => '""',
  BooleanValue: ({ value }) => JSON.stringify(value),
  EnumValue: ({ value }) => value,
  ListValue: ({ values }) => '[]',
  ObjectValue: ({ fields }) => '{}',
  ObjectField: ({ name, value }) => name + ': ' + value,

  // Directive

  Directive: ({ name, arguments: args }) =>
    '@' + name + wrap('(', join(args && args.slice().sort(), ','), ')'),

  // Type

  NamedType: ({ name }) => name,
  ListType: ({ type }) => '[' + type + ']',
  NonNullType: ({ type }) => type + '!',

  // Type System Definitions

  SchemaDefinition: ({ directives, operationTypes }) =>
    join([
      'schema',
      join(directives, ' '),
      block(operationTypes),
    ], ' '),

  OperationTypeDefinition: ({ operation, type }) =>
    operation + ':' + type,

  ScalarTypeDefinition: ({ name, directives }) =>
    join([ 'scalar', name, join(directives, ' ') ], ' '),

  ObjectTypeDefinition: ({ name, interfaces, directives, fields }) =>
    join([
      'type',
      name,
      wrap('implements ', join(interfaces, ', ')),
      join(directives, ' '),
      block(fields)
    ], ' '),

  FieldDefinition: ({ name, arguments: args, type, directives }) =>
    name +
    wrap('(', join(args, ','), ')') +
    ':' + type +
    wrap(' ', join(directives, ' ')),

  InputValueDefinition: ({ name, type, defaultValue, directives }) =>
    join([
      name + ':' + type,
      wrap('= ', defaultValue),
      join(directives, ' ')
    ], ' '),

  InterfaceTypeDefinition: ({ name, directives, fields }) =>
    join([
      'interface',
      name,
      join(directives, ' '),
      block(fields)
    ], ' '),

  UnionTypeDefinition: ({ name, directives, types }) =>
    join([
      'union',
      name,
      join(directives, ' '),
      '= ' + join(types, ' | ')
    ], ' '),

  EnumTypeDefinition: ({ name, directives, values }) =>
    join([
      'enum',
      name,
      join(directives, ' '),
      block(values)
    ], ' '),

  EnumValueDefinition: ({ name, directives }) =>
    join([ name, join(directives, ' ') ], ' '),

  InputObjectTypeDefinition: ({ name, directives, fields }) =>
    join([
      'input',
      name,
      join(directives, ' '),
      block(fields)
    ], ' '),

  TypeExtensionDefinition: ({ definition }) => `extend ${definition}`,

  DirectiveDefinition: ({ name, arguments: args, locations }) =>
    'directive @' + name + wrap('(', join(args, ', '), ')') +
    ' on ' + join(locations, ' | '),
};

/**
 * Given maybeArray, print an empty string if it is null or empty, otherwise
 * print all items together separated by separator if provided
 */
function join(maybeArray, separator) {
  return maybeArray ? maybeArray.filter(x => x).join(separator || '') : '';
}

/**
 * Given array, print each item on its own line, wrapped in an
 * indented "{ }" block.
 */
function block(array) {
  return array && array.length !== 0 ?
    indent('{' + join(array, ' ')) + '}' :
    '{}';
}

/**
 * If maybeString is not null or empty, then wrap with start and end, otherwise
 * print an empty string.
 */
function wrap(start, maybeString, end) {
  return maybeString ?
    start + maybeString + (end || '') :
    '';
}

function indent(maybeString) {
  return maybeString && maybeString.replace(/\n/g, '\n  ');
}
