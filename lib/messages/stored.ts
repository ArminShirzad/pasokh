import type { Card, OutboundMessage } from "./outbound";

/**
 * A response as a smart reply stores it: a message, or a reference to a
 * showcase whose current cards are sent in its place. Editing a showcase
 * changes every reply that shows it, which is what a product list needs.
 */
export type StoredResponse = OutboundMessage | { type: "showcase"; showcaseId: string };

/** Turns stored responses into sendable messages; null where a showcase is gone. */
export function resolveResponses(
  responses: StoredResponse[],
  showcases: ReadonlyMap<string, Card[]>,
): (OutboundMessage | null)[] {
  return responses.map((response) => {
    if (response.type !== "showcase") return response;
    const cards = showcases.get(response.showcaseId);
    return cards ? { type: "cards", cards } : null;
  });
}

export function showcaseIdsOf(responses: readonly StoredResponse[]): string[] {
  return [...new Set(responses.flatMap((r) => (r.type === "showcase" ? [r.showcaseId] : [])))];
}
