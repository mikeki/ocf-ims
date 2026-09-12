// SPDX-License-Identifier: Apache-2.0

import { Code, ConnectError } from "@connectrpc/connect";
import type {
  FieldPath,
  FieldPathElement,
} from "@ocf-ims/protocol-buffers/buf/validate/validate_pb";
import { ViolationsSchema } from "@ocf-ims/protocol-buffers/buf/validate/validate_pb";

// The one error mapping (plan 09i §5, 09l F12): every ConnectError a screen
// could see becomes an AppError, and the screen renders the AppError — it never
// switches on a Connect code itself. Server messages are safe to show: since
// #234 the server keeps causes off the wire (PublicError / InternalError).

export type AppErrorKind =
  /** Not signed in / bad credentials. The session layer handles it; a login screen shows "wrong email or password". */
  | "unauthenticated"
  /** Signed in, but this action is not allowed here. */
  | "forbidden"
  /** The thing does not exist — or is private and hidden (an empty state, not an error). */
  | "notFound"
  /** The request failed validation; `violations` carries the fields. */
  | "invalid"
  /** AlreadyExists. */
  | "conflict"
  /** FailedPrecondition (e.g. clearing the last admin). */
  | "precondition"
  /** ResourceExhausted — the login throttle; `retryAfterSeconds` drives a countdown. */
  | "throttled"
  /** The server could not be reached or answered Unavailable; worth retrying. */
  | "unavailable"
  /** The call was cancelled by the caller (an unmounted query). Never shown. */
  | "canceled"
  /** A blob route refused the upload's size (413); `message` is the server's. */
  | "tooLarge"
  /** Everything else: generic, with the request id when the server echoed one. */
  | "unknown";

export interface FieldViolation {
  /** Field path in protobuf-es (camelCase) property names, e.g. "personIds[2]" or "incident.summary". */
  readonly field: string;
  /** The same path with the proto field names, as protovalidate reports it. */
  readonly protoField: string;
  readonly message: string;
  readonly ruleId: string;
}

export interface AppError {
  readonly kind: AppErrorKind;
  /** The Connect code, when the cause was a ConnectError. */
  readonly code: Code | undefined;
  readonly title: string;
  readonly message: string;
  /** Whether trying again without changing anything could succeed. */
  readonly retryable: boolean;
  /** Only for `throttled`: how long the server asked us to wait. */
  readonly retryAfterSeconds?: number;
  /** Only for `invalid`: the protovalidate violations, one per field. */
  readonly violations: readonly FieldViolation[];
  /** The server-echoed X-Request-Id, for the generic message and bug reports. */
  readonly requestId?: string;
  readonly cause: unknown;
}

const APP_ERROR = Symbol.for("ocf-ims.AppError");

interface BrandedAppError extends AppError {
  readonly [APP_ERROR]: true;
}

export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<BrandedAppError>)[APP_ERROR] === true
  );
}

/** The default wait when a throttled answer carries no usable Retry-After. */
export const DEFAULT_RETRY_AFTER_SECONDS = 30;

export function toAppError(err: unknown): AppError {
  if (isAppError(err)) {
    return err;
  }
  if (!(err instanceof ConnectError)) {
    return brand({
      kind: "unknown",
      code: undefined,
      title: "Something went wrong",
      message: err instanceof Error ? err.message : String(err),
      retryable: false,
      violations: [],
      cause: err,
    });
  }
  const requestId = err.metadata.get("x-request-id") ?? undefined;
  const base = {
    code: err.code,
    violations: [],
    requestId,
    cause: err,
  } as const;
  switch (err.code) {
    case Code.Unauthenticated:
      return brand({
        ...base,
        kind: "unauthenticated",
        title: "Signed out",
        message: "Your session has ended. Sign in again.",
        retryable: false,
      });
    case Code.PermissionDenied:
      return brand({
        ...base,
        kind: "forbidden",
        title: "Not allowed",
        message: "You can't do that here.",
        retryable: false,
      });
    case Code.NotFound:
      return brand({
        ...base,
        kind: "notFound",
        title: "Not found",
        message: err.rawMessage || "There's nothing here.",
        retryable: false,
      });
    case Code.InvalidArgument: {
      const violations = violationsOf(err);
      return brand({
        ...base,
        kind: "invalid",
        title: "Check the details",
        message:
          violations.length > 0
            ? "Some of the details aren't valid."
            : err.rawMessage || "Some of the details aren't valid.",
        retryable: false,
        violations,
      });
    }
    case Code.AlreadyExists:
      return brand({
        ...base,
        kind: "conflict",
        title: "Already exists",
        message: err.rawMessage || "That already exists.",
        retryable: false,
      });
    case Code.FailedPrecondition:
      return brand({
        ...base,
        kind: "precondition",
        title: "Can't do that right now",
        message: err.rawMessage || "That can't be done right now.",
        retryable: false,
      });
    case Code.ResourceExhausted: {
      const retryAfterSeconds = retryAfterOf(err);
      return brand({
        ...base,
        kind: "throttled",
        title: "Too many attempts",
        message: `Too many attempts — try again in ${retryAfterSeconds} s.`,
        retryable: false,
        retryAfterSeconds,
      });
    }
    case Code.Unavailable:
    case Code.DeadlineExceeded:
      return unavailable(base);
    case Code.Canceled:
      return brand({
        ...base,
        kind: "canceled",
        title: "Cancelled",
        message: "The request was cancelled.",
        retryable: false,
      });
    default:
      if (isNetworkFailure(err)) {
        return unavailable(base);
      }
      return brand({
        ...base,
        kind: "unknown",
        title: "Something went wrong",
        message: requestId
          ? `Something went wrong. Request id ${requestId}.`
          : "Something went wrong.",
        retryable: false,
      });
  }
}

/**
 * The mapping for the plain-HTTP blob routes (plan 09s), which answer with a
 * status and a text body rather than a Connect error. `status` 0 is a
 * transport failure (no network, an abort).
 */
export function httpStatusError(
  status: number,
  message: string,
  requestId?: string,
): AppError {
  const base = {
    code: undefined,
    violations: [],
    requestId,
    cause: new Error(message || `HTTP ${status}`),
  } as const;
  switch (status) {
    case 401:
      return brand({
        ...base,
        kind: "unauthenticated",
        title: "Signed out",
        message: "Your session has ended. Sign in again.",
        retryable: false,
      });
    case 403:
      return brand({
        ...base,
        kind: "forbidden",
        title: "Not allowed",
        message: "You can't do that here.",
        retryable: false,
      });
    case 404:
      return brand({
        ...base,
        kind: "notFound",
        title: "Not found",
        message: message || "There's nothing here.",
        retryable: false,
      });
    case 413:
      return brand({
        ...base,
        kind: "tooLarge",
        title: "Too large",
        message: message || "That file is too large.",
        retryable: false,
      });
    case 0:
    case 502:
    case 503:
    case 504:
      return unavailable(base);
    default:
      return brand({
        ...base,
        kind: "unknown",
        title: "Something went wrong",
        message: requestId
          ? `Something went wrong. Request id ${requestId}.`
          : "Something went wrong.",
        retryable: false,
      });
  }
}

function unavailable(
  base: Pick<AppError, "code" | "violations" | "requestId" | "cause">,
): AppError {
  return brand({
    ...base,
    kind: "unavailable",
    title: "Can't reach the server",
    message: "Can't reach the server. Check the connection and try again.",
    retryable: true,
  });
}

/**
 * connect-web wraps a failed fetch (no network, DNS, a refused connection) in a
 * ConnectError with code Unknown whose cause is the fetch TypeError. That is a
 * transport failure, not a server answer.
 */
function isNetworkFailure(err: ConnectError): boolean {
  return (
    (err.code === Code.Unknown || err.code === Code.Internal) &&
    err.cause instanceof TypeError
  );
}

function retryAfterOf(err: ConnectError): number {
  const raw = err.metadata.get("retry-after");
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_RETRY_AFTER_SECONDS;
}

function violationsOf(err: ConnectError): FieldViolation[] {
  let details: ReturnType<typeof err.findDetails<typeof ViolationsSchema>>;
  try {
    details = err.findDetails(ViolationsSchema);
  } catch {
    return [];
  }
  return details.flatMap((d) =>
    d.violations.map((v) => ({
      field: fieldPathString(v.field, true),
      protoField: fieldPathString(v.field, false),
      message: v.message,
      ruleId: v.ruleId,
    })),
  );
}

function fieldPathString(path: FieldPath | undefined, camel: boolean): string {
  if (!path) {
    return "";
  }
  return path.elements
    .map((e) => elementString(e, camel))
    .filter((s) => s.length > 0)
    .join(".");
}

function elementString(e: FieldPathElement, camel: boolean): string {
  const name = camel ? protoCamelCase(e.fieldName) : e.fieldName;
  switch (e.subscript.case) {
    case "index":
    case "intKey":
    case "uintKey":
      return `${name}[${e.subscript.value.toString()}]`;
    case "boolKey":
      return `${name}[${e.subscript.value ? "true" : "false"}]`;
    case "stringKey":
      return `${name}[${JSON.stringify(e.subscript.value)}]`;
    default:
      return name;
  }
}

/** protoc's JSON-name rule, which protobuf-es uses for property names: drop each underscore and capitalise what follows. */
function protoCamelCase(name: string): string {
  return name.replace(/_([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase());
}

function brand(err: AppError): AppError {
  return Object.freeze({ ...err, [APP_ERROR]: true } as BrandedAppError);
}
