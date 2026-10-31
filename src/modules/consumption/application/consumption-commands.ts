import type { DatabaseClient } from "@/lib/db/types";
import type { ConfirmUseInput, ConsumptionClock } from "../domain/types";
import { confirmUse } from "./confirm-use";

export function createConsumptionCommandService(db: DatabaseClient, clock: ConsumptionClock = { now: () => new Date() }) {
  return { confirmUse: (ownerId: string, input: ConfirmUseInput) => confirmUse(db, clock, ownerId, input) };
}
