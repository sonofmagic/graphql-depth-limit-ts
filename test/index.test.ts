import depthLimit from '@/index'
import { parse, Source, validate, specifiedRules, buildSchema } from 'graphql'

function createDocument(query: string) {
  const source = new Source(query, 'GraphQL request')
  return parse(source)
}

// Thanks to ashfurrow!
// @url https://github.com/ashfurrow/graphql-depth-limit/blob/master/test.js
const petMixin = `
  name: String!
  owner: Human!
`

const schema = buildSchema(`
  type Query {
    user(name: String): Human
    version: String
    user1: Human
    user2: Human
    user3: Human
    users(first: Int, after: String): HumanConnection!
  }

  type Human {
    name: String!
    email: String!
    address: Address
    pets: [Pet]
  }

  type HumanConnection {
    edges: [HumanEdge]
    pageInfo: PageInfo! 
  }

  type HumanEdge {
    node: Human
    cursor: String!
  }

  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
    endCursor: String
  }

  interface Pet {
    ${petMixin}
  }

  type Cat {
    ${petMixin}
  }

  type Dog {
    ${petMixin}
  }

  type Address {
    street: String
    number: Int
    city: String
    country: String
  }
`)

const introQuery = `
  query IntrospectionQuery {
    __schema {
      queryType { name }
      mutationType { name }
      subscriptionType { name }
      types {
        ...FullType
      }
      directives {
        name
        description
        locations
        args {
          ...InputValue
        }
      }
    }
  }

  fragment FullType on __Type {
    kind
    name
    description
    fields(includeDeprecated: true) {
      name
      description
      args {
        ...InputValue
      }
      type {
        ...TypeRef
      }
      isDeprecated
      deprecationReason
    }
    inputFields {
      ...InputValue
    }
    interfaces {
      ...TypeRef
    }
    enumValues(includeDeprecated: true) {
      name
      description
      isDeprecated
      deprecationReason
    }
    possibleTypes {
      ...TypeRef
    }
  }

  fragment InputValue on __InputValue {
    name
    description
    type { ...TypeRef }
    defaultValue
  }

  fragment TypeRef on __Type {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
                ofType {
                  kind
                  name
                }
              }
            }
          }
        }
      }
    }
  }
`

describe('[Default]', () => {
  test('should count depth without fragment', () => {
    const query = `
      query read0 {
        version
      }
      query read1 {
        version
        user {
          name
        }
      }
      query read2 {
        matt: user(name: "matt") {
          email
        }
        andy: user(name: "andy") {
          email
          address {
            city
          }
        }
      }
      query read3 {
        matt: user(name: "matt") {
          email
        }
        andy: user(name: "andy") {
          email
          address {
            city
          }
          pets {
            name
            owner {
              name
            }
          }
        }
      }
    `
    const document = createDocument(query)
    const d = {
      read0: 0,
      read1: 1,
      read2: 2,
      read3: 3
    }

    const errors = validate(schema, document, [
      ...specifiedRules,
      depthLimit(10, {}, (depths) => {
        expect(d).toEqual(depths)
      })
    ])
    expect(errors.length).toBe(0)
  })
  test('should count with fragments', () => {
    const query = `
      query read0 {
        ... on Query {
          version
        }
      }
      query read1 {
        version
        user {
          ... on Human {
            name
          }
        }
      }
      fragment humanInfo on Human {
        email
      }
      fragment petInfo on Pet {
        name
        owner {
          name
        }
      }
      query read2 {
        matt: user(name: "matt") {
          ...humanInfo
        }
        andy: user(name: "andy") {
          ...humanInfo
          address {
            city
          }
        }
      }
      query read3 {
        matt: user(name: "matt") {
          ...humanInfo
        }
        andy: user(name: "andy") {
          ... on Human {
            email
          }
          address {
            city
          }
          pets {
            ...petInfo
          }
        }
      }
    `
    const document = createDocument(query)
    const d = {
      read0: 0,
      read1: 1,
      read2: 2,
      read3: 3
    }

    const errors = validate(schema, document, [
      ...specifiedRules,
      depthLimit(10, {}, (depths) => {
        expect(d).toEqual(depths)
      })
    ])
    expect(errors.length).toBe(0)
  })

  test('should ignore the introspection query', () => {
    const document = createDocument(introQuery)

    const errors = validate(schema, document, [
      ...specifiedRules,
      depthLimit(5)
    ])
    expect(errors.length).toBe(0)
  })
  test('should catch a query thats too deep', () => {
    const query = `{
      user {
        pets {
          owner {
            pets {
              owner {
                pets {
                  name
                }
              }
            }
          }
        }
      }
    }`

    const document = createDocument(query)
    const errors = validate(schema, document, [
      ...specifiedRules,
      depthLimit(4)
    ])
    expect(errors.length).toBe(1)
    expect(errors[0].message).toBe("'' exceeds maximum operation depth of 4")
  })

  test('should ignore a field', () => {
    const query = `
      query read1 {
        user { address { city } }
      }
      query read2 {
        user1 { address { city } }
        user2 { address { city } }
        user3 { address { city } }
      }
    `
    const document = createDocument(query)
    const options = {
      ignore: ['user1', /user2/, (fieldName: string) => fieldName === 'user3']
    }
    const d = {
      read1: 2,
      read2: 0
    }

    const errors = validate(schema, document, [
      ...specifiedRules,
      depthLimit(10, options, (depths) => expect(d).toEqual(depths))
    ])
    expect(errors.length).toBe(0)
  })
})

describe('[Cursor Connection Spec Support]', () => {
  test('disabled', () => {
    const query = `
      query read1 {
        users { edges { node { address { city } } } }
      }
    `
    const document = createDocument(query)
    const options = {
      cursorConnectionSpecSupport: false
    }

    const errors = validate(schema, document, [
      ...specifiedRules,
      depthLimit(10, options, (depths) => expect(depths.read1).toEqual(4))
    ])
    expect(errors.length).toBe(0)
  })

  describe('enabled', () => {
    const options = {
      cursorConnectionSpecSupport: true
    }

    test('node object with flat value only', () => {
      const query = `
        query read1 {
          users { edges { node { name } } }
        }
      `
      const document = createDocument(query)

      const errors = validate(schema, document, [
        ...specifiedRules,
        depthLimit(1, options, (depths) => expect(depths.read1).toEqual(1))
      ])
      expect(errors.length).toBe(0)
    })

    test('node object with deeper nesting', () => {
      const query = `
        query read1 {
          users { edges { node { name, address { city } } } }
        }
      `
      const document = createDocument(query)

      const errors = validate(schema, document, [
        ...specifiedRules,
        depthLimit(2, options, (depths) => expect(depths.read1).toEqual(2))
      ])
      expect(errors.length).toBe(0)
    })

    test('Connection.pageInfo - pageInfo is an object, so it is counted as another level', () => {
      const query = `
        query read1 {
          users { pageInfo { hasNextPage } }
        }
      `
      const document = createDocument(query)

      const errors = validate(schema, document, [
        ...specifiedRules,
        depthLimit(2, options, (depths) => expect(depths.read1).toEqual(2))
      ])
      expect(errors.length).toBe(0)
    })

    test('Edge.cursor - cursor is a flat value, so no level added', () => {
      const query = `
        query read1 {
          users { edges { cursor } }
        }
      `
      const document = createDocument(query)

      const errors = validate(schema, document, [
        ...specifiedRules,
        depthLimit(1, options, (depths) => expect(depths.read1).toEqual(1))
      ])
      console.log(errors)
      expect(errors.length).toBe(0)
    })
  })
})
