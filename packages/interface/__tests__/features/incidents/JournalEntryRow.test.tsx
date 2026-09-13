// SPDX-License-Identifier: Apache-2.0

import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { JournalEntryRow } from "@/features/incidents/JournalEntryRow";
import { createFakeBlobs } from "@/test/fakeBlobs";
import { makeJournalEntry } from "@/test/fixtures";
import { createTestRuntime, renderWithProviders } from "@/test/harness";

// An attachment on a journal entry (plan 09s): an image renders inline,
// addressed by the entry id with the session's headers, and opens on a tap;
// anything else is a file row.

const on = { eventName: "Fair 2026", incidentNumber: 214 };

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

  it("never renders an image where there is no attachment route (a report)", async () => {
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
