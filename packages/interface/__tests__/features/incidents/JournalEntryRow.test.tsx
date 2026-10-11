// SPDX-License-Identifier: Apache-2.0

import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { JournalEntryRow } from "@/features/incidents/JournalEntryRow";
import { createFakeBlobs } from "@/test/fakeBlobs";
import { makeJournalEntry } from "@/test/fixtures";
import { createTestRuntime, renderWithProviders } from "@/test/harness";

// An attachment on a journal entry (plan 09s): an image renders inline,
// addressed by the entry id with the session's headers, and opens on a tap;
// anything else is a file row. The owner picks the route (09z criterion 0):
// a report's entry is addressed through the report route, never the incident's.

const on = { eventName: "Fair 2026", kind: "incident", number: 214 } as const;

describe("JournalEntryRow attachments", () => {
  it("renders an image attachment inline and opens it on a tap", async () => {
    const blobs = createFakeBlobs();
    const runtime = createTestRuntime({ blobs });
    const onOpen = jest.fn();
    await renderWithProviders(
      <JournalEntryRow
        entry={makeJournalEntry({
          id: 7,
          text: "Photo of the sign",
          attachment: { id: "abc.png", mediaType: "image/png" },
        })}
        attachmentOn={on}
        onOpenAttachment={onOpen}
      />,
      runtime,
    );
    const image = await waitFor(() => screen.getByTestId("attachment-image-7"));
    await waitFor(() =>
      expect(image.props.source).toEqual([
        {
          uri: blobs.attachmentUrl("Fair 2026", 214, 7),
          headers: { Authorization: "Bearer fake" },
        },
      ]),
    );
    await fireEvent.press(screen.getByTestId("attachment-open-7"));
    expect(onOpen).toHaveBeenCalledWith(7);
    expect(screen.queryByTestId("attachment-file-7")).toBeNull();
  });

  it("renders any other attachment as a file row", async () => {
    const runtime = createTestRuntime({ blobs: createFakeBlobs() });
    await renderWithProviders(
      <JournalEntryRow
        entry={makeJournalEntry({
          id: 8,
          attachment: { id: "notes.pdf", mediaType: "application/pdf" },
        })}
        attachmentOn={on}
      />,
      runtime,
    );
    expect(screen.getByTestId("attachment-file-8")).toBeTruthy();
    expect(screen.getByText("application/pdf")).toBeTruthy();
    expect(screen.queryByTestId("attachment-image-8")).toBeNull();
  });

  it("addresses a report's entry through the report route", async () => {
    const blobs = createFakeBlobs();
    const runtime = createTestRuntime({ blobs });
    await renderWithProviders(
      <JournalEntryRow
        entry={makeJournalEntry({
          id: 11,
          attachment: { id: "sign.png", mediaType: "image/png" },
        })}
        attachmentOn={{ eventName: "Fair 2026", kind: "report", number: 3 }}
      />,
      runtime,
    );
    const image = await waitFor(() =>
      screen.getByTestId("attachment-image-11"),
    );
    await waitFor(() =>
      expect(image.props.source).toEqual([
        {
          uri: blobs.reportAttachmentUrl("Fair 2026", 3, 11),
          headers: { Authorization: "Bearer fake" },
        },
      ]),
    );
    expect(image.props.source[0].uri).toContain("/reports/3/attachments/11");
    expect(screen.queryByTestId("attachment-open-11")).toBeNull();
  });

  it("never renders an image where there is no attachment route", async () => {
    const runtime = createTestRuntime({ blobs: createFakeBlobs() });
    await renderWithProviders(
      <JournalEntryRow
        entry={makeJournalEntry({
          id: 9,
          attachment: { id: "abc.png", mediaType: "image/png" },
        })}
      />,
      runtime,
    );
    expect(screen.getByTestId("attachment-file-9")).toBeTruthy();
  });
});
