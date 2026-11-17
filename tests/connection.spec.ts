import { expect, it } from 'vitest'
import { remoteTarget } from '../src/client/connection.ts'

it('separates temporary credentials from the only persisted address', () => {
  expect(remoteTarget('example.com', 'test token')).toEqual({ address: 'https://example.com', login: 'https://example.com/?token=test+token' })
  expect(remoteTarget('https://example.com/?token=test-token', '')).toEqual({ address: 'https://example.com', login: 'https://example.com/?token=test-token' })
  expect(remoteTarget('https://example.com', '')).toEqual({ address: 'https://example.com', login: 'https://example.com/' })
})

it.each(['http://example.com', 'https://user:pass@example.com', 'https://example.com/other', 'https://example.com/?next=https://other.example.com', 'https://example.com/#secret', 'https://example.com/?token=a&token=b', 'file:///etc/passwd'])('rejects unsupported endpoint %s', address => {
  expect(() => remoteTarget(address, '')).toThrow()
})
