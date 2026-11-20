// Simply supported rectangular rail, central point load. Price is in currency units/kg.
export function shelfRail(limit = "2 mm") {
  return {
    regions: [
      ["mass", "mass := density * width * thickness * span"],
      ["thickness", "thickness := 15 mm"],
      ["width", "width := 40 mm"],
      ["span", "span := 1 m"],
      ["force", "force := 100 N"],
      ["modulus", "modulus := 200000 MPa"],
      ["density", "density := 7800 kg/m^3"],
      ["allowable", "allowable := 100 MPa"],
      ["inertia", "inertia := width * thickness^3 / 12"],
      ["deflection", "deflection := force * span^3 / (48 * modulus * inertia)"],
      ["stress", "stress := force * span * thickness / (8 * inertia)"],
      ["sag", "deflection <= " + limit],
      ["strength", "stress <= allowable"],
      ["cost", "cost := mass * 3 / kg"],
    ].map(([id, text]) => ({ id, text, mathVersion: 3 })),
    contexts: [{ id: "original", label: "Original", base: {}, overrides: {} }],
    active: "original",
    layout: {},
    plots: [],
    origin: { x: 50, y: 90 },
  };
}
export const railSpec = {
  goal: "mass",
  mode: "minimize",
  axes: [{ id: "thickness", low: "5", high: "20" }],
  requirements: ["sag", "strength"],
  reports: ["cost"],
};
// Delta = F*L^3/(4*E*b*h^3) ; positive h on the sag boundary.
export const sagThickness = (widthMM, sagMM) =>
  1000 * Math.cbrt(100 / (4 * 200e9 * (widthMM / 1000) * (sagMM / 1000)));
