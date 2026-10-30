/** Compile-only witnesses: invalid feature requests must not enter the dispatcher. */
import type {
  CommandRequest,
  CommandTarget,
} from "../../src/regions/interaction/commands.ts";
import type { ConnectionEdit } from "../../src/regions/document.ts";

declare const dispatch: (request: CommandRequest) => void;
declare const target: CommandTarget;
declare const connection: ConnectionEdit;

dispatch({ operation: "response.plot", target, input: "F", output: "P" });
dispatch({ operation: "response.open", target, view: "plot-1" });
dispatch({
  operation: "quantity.connect",
  target,
  connection,
  symbol: "force",
});
dispatch({ operation: "canvas.undo", target });

// @ts-expect-error Unknown operations need an explicit contract and dispatcher implementation.
dispatch({ operation: "feature.new-history", target });
// @ts-expect-error Plotting requires the chosen input, not an unrelated optional argument.
dispatch({ operation: "response.plot", target, output: "P" });
// @ts-expect-error Computation inspection requires its output definition.
dispatch({ operation: "definition.code", target, input: "F" });
// @ts-expect-error Opening a response requires the representation identity.
dispatch({ operation: "response.open", target });
// @ts-expect-error Data visualization requires the reviewed relationship/view identity.
dispatch({ operation: "dataset.visualize", target });
// @ts-expect-error Undo cannot carry a connection payload.
dispatch({ operation: "canvas.undo", target, connection });
