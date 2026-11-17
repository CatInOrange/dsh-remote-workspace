/** Validated root endpoint and temporary authentication navigation. */
export interface RemoteTarget { address: string; login: string }

/** Accept HTTPS origin or native launch link; never persist a credential-bearing URL.
 * @param address - server address or launch link.
 * @param token - separately entered native access token.
 * @returns sanitized address and temporary login URL.
 */
export function remoteTarget(address: string, token: string): RemoteTarget {
  const url = new URL(address.includes('://') ? address : `https://${address}`)
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== ''
    || url.pathname !== '/' || url.hash !== ''
    || [...url.searchParams.keys()].some(key => key !== 'token')
    || url.searchParams.getAll('token').length > 1) throw new Error('invalid-address')
  const accessToken = token.trim() || url.searchParams.get('token') || ''
  const login = new URL(url.origin)
  if (accessToken !== '') login.searchParams.set('token', accessToken)
  return { address: url.origin, login: login.href }
}
