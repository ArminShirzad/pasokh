// Plain zernio.com, not Pasokh's referral link (zernio.link/diwen): a
// referral credits whoever owns it, and Pasokh is not part of that
// sponsorship. Swap in a Pasokh referral base here once one exists.
const ZERNIO_BASE = "https://zernio.com";

export function zernioLink({ path = '/', placement }: { path?: string; placement: string }): string {
  if (/^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/)/.test(path)) throw new Error('Expected a Zernio destination.');
  const url = new URL(path.replace(/^\/+/, ''), `${ZERNIO_BASE}/`);
  if (!['zernio.link', 'zernio.com', 'docs.zernio.com'].includes(url.hostname) || url.protocol !== 'https:') throw new Error('Expected a Zernio destination.');
  url.searchParams.set('utm_source', 'pasokh');
  url.searchParams.set('utm_content', placement);
  return url.toString();
}
