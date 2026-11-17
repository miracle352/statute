// Builds the shape evidence.networkFromPack returns, so judges can be tested without Kane.
const T0 = Date.parse("2026-11-17T10:00:00Z");
const at = (s) => new Date(T0 + s * 1000).toISOString();
const click = (instruction, s, extra = {}) => ({ type: "click", status: "passed", instruction, time: at(s), ...extra });
const req = (url, s, extra = {}) => ({ url, method: "GET", status: 200, time: at(s), ...extra });
const net = ({ actions = [], requests = [], harFiles = 1 } = {}) => ({ actions, requests, harFiles });
module.exports = { at, click, req, net };
