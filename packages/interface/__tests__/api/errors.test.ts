// SPDX-License-Identifier: Apache-2.0

import { Code, ConnectError } from "@connectrpc/connect";
import { ViolationsSchema } from "@ocf-ims/protocol-buffers/buf/validate/validate_pb";
import {
  DEFAULT_RETRY_AFTER_SECONDS,
  isAppError,
  toAppError,
} from "@/api/errors";

// The one error mapping (plan 09l F12), case by case.

describe("toAppError", () => {
  it.each([
    [Code.Unauthenticated, "unauthenticated", false],
    [Code.PermissionDenied, "forbidden", false],
    [Code.NotFound, "notFound", false],
    [Code.AlreadyExists, "conflict", false],
    [Code.FailedPrecondition, "precondition", false],
    [Code.Unavailable, "unavailable", true],
    [Code.DeadlineExceeded, "unavailable", true],
    [Code.Canceled, "canceled", false],
    [Code.Internal, "unknown", false],
    [Code.Unimplemented, "unknown", false],
  ])("maps code %s to kind %s (retryable %s)", (code, kind, retryable) => {
    const err = toAppError(new ConnectError("boom", code));
    expect(err.kind).toBe(kind);
    expect(err.retryable).toBe(retryable);
    expect(err.code).toBe(code);
    expect(isAppError(err)).toBe(true);
  });

  it("shows the server's message for NotFound / AlreadyExists / FailedPrecondition", () => {
    expect(
      toAppError(
        new ConnectError(
          "cannot remove the last admin",
          Code.FailedPrecondition,
        ),
      ).message,
    ).toBe("cannot remove the last admin");
    expect(
      toAppError(new ConnectError("no such event", Code.NotFound)).message,
    ).toBe("no such event");
  });

  it("decodes protovalidate violations into field paths", () => {
    const err = new ConnectError("invalid", Code.InvalidArgument, undefined, [
      {
        desc: ViolationsSchema,
        value: {
          violations: [
            {
              field: {
                elements: [
                  {
                    fieldName: "person_ids",
                    subscript: { case: "index", value: 2n },
                  },
                ],
              },
              ruleId: "int32.gt",
              message: "value must be greater than 0",
            },
            {
              field: {
                elements: [
                  { fieldName: "incident" },
                  {
                    fieldName: "event_access",
                    subscript: { case: "intKey", value: 7n },
                  },
                ],
              },
              ruleId: "required",
              message: "value is required",
            },
          ],
        },
      },
    ]);

    const mapped = toAppError(err);

    expect(mapped.kind).toBe("invalid");
    expect(mapped.violations).toEqual([
      {
        field: "personIds[2]",
        protoField: "person_ids[2]",
        ruleId: "int32.gt",
        message: "value must be greater than 0",
      },
      {
        field: "incident.eventAccess[7]",
        protoField: "incident.event_access[7]",
        ruleId: "required",
        message: "value is required",
      },
    ]);
  });

  it("falls back to the message when InvalidArgument carries no violations", () => {
    const mapped = toAppError(
      new ConnectError("password too long", Code.InvalidArgument),
    );
    expect(mapped.kind).toBe("invalid");
    expect(mapped.violations).toEqual([]);
    expect(mapped.message).toBe("password too long");
  });

  it("reads Retry-After on a throttled answer, with a default", () => {
    const throttled = toAppError(
      new ConnectError("slow down", Code.ResourceExhausted, {
        "Retry-After": "12",
      }),
    );
    expect(throttled.kind).toBe("throttled");
    expect(throttled.retryAfterSeconds).toBe(12);
    expect(throttled.message).toContain("12 s");

    const bare = toAppError(
      new ConnectError("slow down", Code.ResourceExhausted),
    );
    expect(bare.retryAfterSeconds).toBe(DEFAULT_RETRY_AFTER_SECONDS);
  });

  it("treats a failed fetch (Unknown with a TypeError cause) as unavailable", () => {
    const err = new ConnectError(
      "Failed to fetch",
      Code.Unknown,
      undefined,
      undefined,
      new TypeError("Failed to fetch"),
    );
    const mapped = toAppError(err);
    expect(mapped.kind).toBe("unavailable");
    expect(mapped.retryable).toBe(true);
  });

  it("carries the echoed request id into the generic message", () => {
    const mapped = toAppError(
      new ConnectError("boom", Code.Internal, { "X-Request-Id": "REQ123" }),
    );
    expect(mapped.kind).toBe("unknown");
    expect(mapped.requestId).toBe("REQ123");
    expect(mapped.message).toContain("REQ123");
  });

  it("wraps a non-Connect error as unknown and passes an AppError through", () => {
    const plain = toAppError(new Error("storage exploded"));
    expect(plain.kind).toBe("unknown");
    expect(plain.code).toBeUndefined();
    expect(plain.message).toBe("storage exploded");
    expect(toAppError(plain)).toBe(plain);
    expect(toAppError("string").message).toBe("string");
  });
});
