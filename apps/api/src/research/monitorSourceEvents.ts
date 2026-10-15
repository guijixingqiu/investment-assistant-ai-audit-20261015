import type { Pool, PoolClient } from "pg";
import type { ResearchAnnouncementEventData } from "../../../../packages/contracts/src/researchEvent.js";
import { DeepResearchGateError } from "./domain.js";
import { readResearchEvents } from "./researchEventRepository.js";

interface EventLocator {
  id: string;
  research_profile_id: string;
  candidate_membership_id: string;
  candidate_membership_version: number | string;
}

export async function readCurrentMonitorSourceEvents(
  client: Pick<Pool | PoolClient, "query">,
  eventIds: string[],
  now: Date
): Promise<Map<string, ResearchAnnouncementEventData>> {
  const ids = [...new Set(eventIds)];
  const locators = await client.query<EventLocator>(
    `select id, research_profile_id, candidate_membership_id, candidate_membership_version
       from research_events
      where id = any($1::bigint[])`,
    [ids]
  );
  if (locators.rows.length !== ids.length) throw new DeepResearchGateError("one or more monitor source events no longer exist");
  const groups = new Map<string, EventLocator>();
  for (const row of locators.rows) groups.set(`${row.research_profile_id}:${row.candidate_membership_id}:${row.candidate_membership_version}`, row);
  const events: ResearchAnnouncementEventData[] = [];
  // ponytail: bounded Local Beta N+1 (max 200 source rows); batch SQL only if measured source volume grows.
  for (const row of groups.values()) {
    events.push(...await readResearchEvents(client, row.research_profile_id, row.candidate_membership_id, Number(row.candidate_membership_version), now));
  }
  const current = new Map(events.filter((event) => ids.includes(event.id)).map((event) => [event.id, event]));
  if (current.size !== ids.length || [...current.values()].some((event) => event.source.freshness !== "fresh" || event.source.revisionState !== "current")) {
    throw new DeepResearchGateError("one or more monitor source events are stale or replaced");
  }
  return current;
}
