/** Promisified ee.ComputedObject.evaluate */
function evaluate(obj) {
  return new Promise((resolve, reject) => obj.evaluate((result, err) => (err ? reject(new Error(err)) : resolve(result))));
}

/** Promisified ee.Image.getMap; returns the XYZ tile URL template. */
function getTileUrl(image, visParams) {
  return new Promise((resolve, reject) =>
    image.getMap(visParams || {}, (map, err) => (err ? reject(new Error(err)) : resolve(map.urlFormat)))
  );
}

module.exports = { evaluate, getTileUrl };
