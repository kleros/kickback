import { cache } from "react";

import { DEFAULT_CHAIN } from "@/config/chains";

import { createEventCardClient } from "./eventCardClient";
import { readEventCard } from "./openGraph";

const publicClient = createEventCardClient(DEFAULT_CHAIN);

export const serverEventCard = cache((contract: string) => readEventCard(publicClient, contract));
