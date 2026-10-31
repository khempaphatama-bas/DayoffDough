import type { DatabaseClient } from "@/lib/db/types";
import type { ConfirmUseInput, CorrectUseInput, ConsumptionClock } from "../domain/types";
import { confirmUse } from "./confirm-use";
import { correctUse } from "./correct-use";

export function createConsumptionCommandService(db: DatabaseClient, clock: ConsumptionClock = { now: () => new Date() }) {
  return {
    confirmUse: (ownerId: string, input: ConfirmUseInput) => confirmUse(db, clock, ownerId, input),
    correctUse: (ownerId: string, input: CorrectUseInput) => correctUse(db, clock, ownerId, input),
  };
}
