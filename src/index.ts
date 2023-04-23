/* eslint-disable no-case-declarations */
import {
  GraphQLError,
  Kind,
  DefinitionNode,
  FragmentDefinitionNode,
  OperationDefinitionNode,
  ValidationContext,
  ASTNode
} from 'graphql'
import arrify from 'arrify'

export type IgnoreItem = string | RegExp | ((queryDepths: any) => boolean)
// https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/graphql-depth-limit/index.d.ts
export interface Options {
  ignore?: IgnoreItem | IgnoreItem[]
}

const depthLimit =
  (
    maxDepth: number,
    options: Options = {},
    callback: (obj: any) => void = () => {}
  ): any =>
  (validationContext: ValidationContext) => {
    try {
      const { definitions } = validationContext.getDocument()
      const fragments = getFragments(definitions)
      const queries = getQueriesAndMutations(definitions)
      const queryDepths: Record<string, number> = {}
      for (const name in queries) {
        queryDepths[name] = determineDepth(
          queries[name],
          fragments,
          0,
          maxDepth,
          validationContext,
          name,
          options
        )
      }
      callback(queryDepths)
      return validationContext
    } catch (err) {
      console.error(err)
      throw err
    }
  }

function getFragments(definitions: readonly DefinitionNode[]) {
  return definitions.reduce<Record<string, FragmentDefinitionNode>>(
    (map, definition) => {
      if (definition.kind === Kind.FRAGMENT_DEFINITION) {
        map[definition.name.value] = definition
      }
      return map
    },
    {}
  )
}

// this will actually get both queries and mutations. we can basically treat those the same
function getQueriesAndMutations(definitions: readonly DefinitionNode[]) {
  return definitions.reduce<Record<string, OperationDefinitionNode>>(
    (map, definition) => {
      if (definition.kind === Kind.OPERATION_DEFINITION) {
        map[definition.name ? definition.name.value : ''] = definition
      }
      return map
    },
    {}
  )
}

function determineDepth(
  node: ASTNode,
  fragments: Record<string, FragmentDefinitionNode>,
  depthSoFar: number,
  maxDepth: number,
  context: ValidationContext,
  operationName: string,
  options?: Options
): number {
  if (depthSoFar > maxDepth) {
    context.reportError(
      new GraphQLError(
        `'${operationName}' exceeds maximum operation depth of ${maxDepth}`,
        {
          nodes: [node]
        }
      )
    )
    return -1
  }

  switch (node.kind) {
    case Kind.FIELD:
      // by default, ignore the introspection fields which begin with double underscores
      const shouldIgnore =
        /^__/.test(node.name.value) || seeIfIgnored(node, options?.ignore)

      if (shouldIgnore || !node.selectionSet) {
        return 0
      }
      return (
        1 +
        Math.max(
          ...node.selectionSet.selections.map((selection) =>
            determineDepth(
              selection,
              fragments,
              depthSoFar + 1,
              maxDepth,
              context,
              operationName,
              options
            )
          )
        )
      )
    case Kind.FRAGMENT_SPREAD:
      return determineDepth(
        fragments[node.name.value],
        fragments,
        depthSoFar,
        maxDepth,
        context,
        operationName,
        options
      )
    case Kind.INLINE_FRAGMENT:
    case Kind.FRAGMENT_DEFINITION:
    case Kind.OPERATION_DEFINITION:
      return Math.max(
        ...node.selectionSet.selections.map((selection) =>
          determineDepth(
            selection,
            fragments,
            depthSoFar,
            maxDepth,
            context,
            operationName,
            options
          )
        )
      )
    default:
      throw new Error('uh oh! depth crawler cannot handle: ' + node.kind)
  }
}

function seeIfIgnored(node: ASTNode, ignore?: IgnoreItem | IgnoreItem[]) {
  if (!ignore) return false

  for (const rule of arrify(ignore)) {
    if (node.kind === Kind.FIELD) {
      const fieldName = node.name.value
      switch (typeof rule) {
        case 'function':
          if (rule(fieldName)) {
            return true
          }
          break
        case 'string':
        case 'object':
          if (fieldName.match(rule)) {
            return true
          }
          break
        default:
          throw new Error(`Invalid ignore option: ${rule}`)
      }
    }
  }
  return false
}

export default depthLimit
