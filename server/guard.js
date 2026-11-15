// Only public websites may be audited: no private networks, no odd ports,
// nothing that could make the server probe its own surroundings.
const dns = require("dns").promises;
const net = require("net");

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") ||
    v.startsWith("::ffff:") && privateIp(v.slice(7));
}

// Returns a clean URL (origin + path, no query) or throws a plain-language error.
async function check(input) {
  let u;
  try { u = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`); } catch { throw new Error("That doesn't look like a web address."); }
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Only http and https addresses can be audited.");
  if (u.username || u.password) throw new Error("Addresses with a username or password can't be audited.");
  if (u.port && !["80", "443"].includes(u.port)) throw new Error("Only standard web ports (80 and 443) can be audited.");
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".")) {
    throw new Error("Only public websites can be audited.");
  }
  if (net.isIP(host) && privateIp(host)) throw new Error("Only public websites can be audited.");
  let addrs;
  try { addrs = await dns.lookup(host, { all: true }); } catch { throw new Error(`Couldn't find ${host}. Check the address.`); }
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error("Only public websites can be audited.");
  const path = u.pathname.replace(/[^A-Za-z0-9/_.~-]/g, "") || "/";
  return `${u.protocol}//${u.host}${path}`;
}

module.exports = { check, privateIp };
