// Shared Lucide paths and rendering contract; aliases preserve private-area call sites.
import { inlineIcon } from "./catalog-icons.ts";
const names={chevron:"chevron-down",add:"plus",save:"bookmark",calendar:"calendar-days",conflict:"triangle-alert",arrow:"arrow-right",check:"check",mail:"mail",clock:"clock",exit:"log-out"} as const;
export function icon(name:keyof typeof names){return inlineIcon(names[name],"ui-icon");}
