import { z } from "zod";
import { ALL_PICKS, type Pick } from "./types";
export const PickArray = z.array(z.enum(ALL_PICKS as [Pick, ...Pick[]])).length(15);
