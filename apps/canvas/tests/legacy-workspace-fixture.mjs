/** Tests may construct the retired v1 wire format to exercise the read boundary. Production never writes it. */
export const legacyWorkspace = (page, artifacts) =>
  JSON.stringify({
    format: "manifold-region-artifacts",
    version: 1,
    page,
    artifacts,
  });
