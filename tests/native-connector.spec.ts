import { expect, it, vi } from 'vitest'
import { RemoteHostConnector } from '../src/native/connector.ts'

const authenticated = () => new Response(null, {
  status: 303, headers: { location: './', 'set-cookie': 'dsh-auth-test=signed.cookie; Path=/; HttpOnly' },
})

it('exchanges a token once and attaches only the issued cookie to API requests', async () => {
  const send = vi.fn().mockResolvedValueOnce(authenticated()).mockResolvedValue(new Response('{}'))
  const connector = new RemoteHostConnector('https://example.com', send)
  await connector.login('temporary-test-token')
  await connector.fetch('api/session/list', { method: 'POST', headers: { authorization: 'unrelated', cookie: 'wrong' } })
  expect(send.mock.calls[0][0]).toBe('https://example.com/?token=temporary-test-token')
  expect(send.mock.calls[0][1].redirect).toBe('manual')
  const [url, init] = send.mock.calls[1]
  expect(url).toBe('https://example.com/api/session/list')
  expect(init.headers.get('cookie')).toBe('dsh-auth-test=signed.cookie')
  expect(init.headers.has('authorization')).toBe(false)
  expect(JSON.stringify(connector)).not.toContain('signed.cookie')
  expect(JSON.stringify(connector)).not.toContain('temporary-test-token')
})

it('rejects untrusted routes and authentication redirects before forwarding credentials', async () => {
  const send = vi.fn().mockResolvedValueOnce(new Response(null, {
    status: 303, headers: { location: 'https://elsewhere.example.com', 'set-cookie': 'dsh-auth-test=signed.cookie' },
  })).mockResolvedValue(authenticated())
  const connector = new RemoteHostConnector('https://example.com', send)
  await expect(connector.login('test')).rejects.toThrow('refused')
  await expect(connector.fetch('api/session/list')).rejects.toThrow('not authenticated')
  await connector.login('test')
  for (const path of ['https://elsewhere.example.com/api/list', '//elsewhere.example.com/api/list', '/api/../other', '/api/session/list?token=test', '/connect', '/api/session/..']) {
    await expect(connector.fetch(path)).rejects.toThrow('Unsupported')
  }
  expect(send).toHaveBeenCalledTimes(2)
})

it('does not retain a late login after disposal and cancels pending API work', async () => {
  let finish!: (value: Response) => void
  const send = vi.fn(() => new Promise<Response>(resolve => { finish = resolve }))
  const connector = new RemoteHostConnector('https://example.com', send)
  const login = connector.login('test')
  connector.dispose()
  finish(authenticated())
  await expect(login).rejects.toThrow()
  await expect(connector.fetch('api/session/list')).rejects.toThrow('disposed')
})

it('forgets rejected credentials and sanitizes errors from transports', async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error('secret token in URL'))
    .mockResolvedValueOnce(authenticated()).mockResolvedValue(new Response(null, { status: 401 }))
  const connector = new RemoteHostConnector('https://example.com', send)
  await expect(connector.login('secret')).rejects.toThrow('Remote authentication request failed')
  await connector.login('test')
  expect((await connector.fetch('api/session/list')).status).toBe(401)
  await expect(connector.fetch('api/session/list')).rejects.toThrow('not authenticated')
})

it('does not let a stale API rejection erase a newer login', async () => {
  let finish!: (value: Response) => void
  const send = vi.fn().mockResolvedValueOnce(authenticated())
    .mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve }))
    .mockResolvedValueOnce(authenticated()).mockResolvedValue(new Response('{}'))
  const connector = new RemoteHostConnector('https://example.com', send)
  await connector.login('first')
  const stale = connector.fetch('api/session/list')
  await connector.login('second')
  finish(new Response(null, { status: 401 }))
  await stale
  expect((await connector.fetch('api/session/list')).status).toBe(200)
})

it('owns authenticated mux sockets and closes them without a session stop request', async () => {
  const connector = new RemoteHostConnector('https://example.com', async () => authenticated())
  await connector.login('test')
  const close = vi.fn()
  const factory = vi.fn(() => ({ socket: { name: 'socket' }, closed: new Promise<void>(() => {}), close }))
  expect(connector.openWebSocket('/api/remote.mux', factory)).toEqual({ name: 'socket' })
  expect(factory).toHaveBeenCalledWith('wss://example.com/api/remote.mux', 'dsh-auth-test=signed.cookie')
  expect(() => connector.openWebSocket('wss://elsewhere.example.com', factory)).toThrow('Unsupported')
  connector.dispose()
  connector.dispose()
  expect(close).toHaveBeenCalledTimes(1)
  expect(() => connector.openWebSocket('/api/remote.mux', factory)).toThrow('disposed')
})
