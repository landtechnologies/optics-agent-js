// This file contains helper functions to format or normalize data.

import { GraphQLList, GraphQLNonNull } from 'graphql/type';
import { separateOperations, opName } from './separateOperations';

import { print } from './normalizedPrinter';


//  //////// GraphQL ////////

// Take a graphql query object and output the "query shape". See
// https://github.com/apollostack/optics-agent/blob/master/docs/signatures.md
// for details.
export const normalizeQuery = (info) => {
  const doc = {
    kind: 'Document',
    definitions: [
      info.operation,
      ...Object.keys(info.fragments).map(k => info.fragments[k]),
    ],
  };

  const prunedAST = separateOperations(doc)[opName(info.operation)];

  return print(prunedAST);
};


// Turn a graphql type into a user-friendly string. eg 'String' or '[Person!]'
export const printType = (type) => {
  if (type instanceof GraphQLList) {
    return `[${printType(type.ofType)}]`;
  } else if (type instanceof GraphQLNonNull) {
    return `${printType(type.ofType)}!`;
  }
  return type.name;
};


//  //////// Client Type ////////

// Takes a Node HTTP Request object (http.IncomingMessage) and returns
// an object with fields `client_name` and `client_version`.
//
// XXX implement https://github.com/apollostack/optics-agent-js/issues/1
export const normalizeVersion = _req => (
  { client_name: 'none', client_version: 'nope' }
);

