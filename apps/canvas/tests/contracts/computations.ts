/** Executors receive only an immutable actual-input capture, not a legacy Page. */
import type {
  ArtifactJob,
  ArtifactRuntime,
} from "../../src/regions/artifactComputations.ts";
declare const job: ArtifactJob;
declare const view: ArtifactRuntime;
// @ts-expect-error Compatibility snapshots are not executor capabilities.
void job.legacy;
// @ts-expect-error Captured scalar inputs cannot be changed by the executor.
job.inputs.force = 0;
// @ts-expect-error Captured definitions are immutable through nested structures.
job.definitions.push({ id: "injected", text: "F = 0" });
// @ts-expect-error A renderer cannot assert a checked result is current.
view.current = true;
declare const receipt: NonNullable<ArtifactRuntime["receipt"]>;
// @ts-expect-error Renderers cannot mutate the shared checked payload.
receipt.points.push([0, 0]);
import { archive } from "../../src/regions/artifacts.ts";
import type { RegionSession } from "../../src/regions/document.ts";
declare const session: RegionSession;
// @ts-expect-error A renderer cannot deliver checked results to a separate owner.
void session.recordArtifactResult;
// @ts-expect-error Superseded checked admission is not an application capability.
void session.completeArtifactResult;
// @ts-expect-error There is one evidence capture, without an application result root.
void session.capture().results;
// @ts-expect-error Native writing cannot accept independently supplied Page/artifact/result state.
archive(session.state, session.artifacts, session.native());
archive(session.native());

import { createArtifactComputations } from "../../src/regions/artifactComputations.ts";
// @ts-expect-error Representations cannot install a second computation executor through demand options.
createArtifactComputations(session, { executor: async () => ({}) });

import { PageEdit } from "../../src/regions/pageEdits.ts";
const region = new PageEdit(session.state).region("region-source");
if (region?.data) {
  // @ts-expect-error Candidate records share immutable source payloads; replace the descriptor.
  region.data.csv = "changed";
}
if (region?.source) {
  // @ts-expect-error An observation's source selection is an immutable shared leaf.
  region.source.row = 1;
}
if (region?.external) {
  // @ts-expect-error Editing a record does not grant mutation of a shared external descriptor.
  region.external.url = "https://example.invalid";
}
// @ts-expect-error Authored scene collections are immutable reads, not a renderer state owner.
session.scene.tools.push({});
// @ts-expect-error Group membership changes use the shared authored command boundary.
session.scene.groups[0].members.push("region-new");
// @ts-expect-error A named camera is immutable authored data; the active camera is view-local.
session.scene.viewpoints[0].camera.zoom = 2;
