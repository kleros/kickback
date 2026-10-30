import { cache } from "react";

import { publicClient } from "@/lib/web3/public-client";

import { readEventCard } from "./openGraph";

export const serverEventCard = cache((contract: string) => readEventCard(publicClient, contract));
