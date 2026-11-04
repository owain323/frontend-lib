var flLabels = function (defaults, src) {
src = src || {};
var out = {};
var k;
for (k in defaults) {
if (Object.prototype.hasOwnProperty.call(defaults, k)) {
out[k] = (src[k] === undefined || src[k] === null) ? defaults[k] : src[k];
}
}
return out;
};
