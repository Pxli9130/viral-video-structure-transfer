import type { StoryboardItem, Timeline } from "../types.js";
import { buildTimeline, type BuildTimelineInput } from "./planner.js";

export function buildRenderableTimeline(input: BuildTimelineInput): { timeline: Timeline; storyboard: StoryboardItem[] } {
  return buildTimeline(input);
}
