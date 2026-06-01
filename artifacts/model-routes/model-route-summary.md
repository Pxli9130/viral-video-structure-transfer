# Model Route Summary

version: model-router-v4.2
generatedAt: 2026-06-01T21:41:31.528Z
totalTasks: 28
requiredTasks: 14
featureGatedRequiredTasks: 0
fallbackUsed: 2
fatal: 0
unsafePolicyIssues: 0
localSampleMediaAnalyses: 5
externalSampleMediaUploads: 0

| Task | Selected provider | Fallback used? | Reason | Core required? | Feature gate | Effect scope | Local sample media | External sample media | Can affect final pixels/audio? | Safety policy |
|---|---|---|---|---|---|---|---|---|---|---|
| video_structure_vlm | heuristic_vlm | yes | Selected heuristic_vlm because gemini_vlm_current: cloud provider disabled by router options. | yes | analysis | planning_affects_recipe | pixels+audio | no | pixels | no_raw_prompt,no_generated_asset,sample_pixels,sample_audio,no_sample_video_upload |
| text_planning_llm | deterministic_planner | yes | Selected deterministic_planner because configured_ai_adapter: cloud provider disabled by router options. | yes | transfer | planning_affects_recipe | no | no | pixels | no_raw_prompt,no_generated_asset,no_sample_pixels,no_sample_audio,no_sample_video_upload |
| technique_atom_extraction | deterministic_planner | no | Primary provider selected for technique_atom_extraction. | yes |  | planning_affects_recipe | no | no | pixels | no_raw_prompt,no_generated_asset,no_sample_pixels,no_sample_audio,no_sample_video_upload |
| json_schema_repair | deterministic_planner | no | Primary provider selected for json_schema_repair. | yes |  | planning_affects_recipe | no | no | pixels | no_raw_prompt,no_generated_asset,no_sample_pixels,no_sample_audio,no_sample_video_upload |
| asset_understanding | deterministic_planner | no | Primary provider selected for asset_understanding. | yes |  | planning_affects_recipe | no | no | pixels | no_raw_prompt,no_generated_asset,no_sample_pixels,no_sample_audio,no_sample_video_upload |
| gap_reasoning | deterministic_planner | no | Primary provider selected for gap_reasoning. | yes |  | planning_affects_recipe | no | no | pixels | no_raw_prompt,no_generated_asset,no_sample_pixels,no_sample_audio,no_sample_video_upload |
| transfer_planning | deterministic_planner | no | Primary provider selected for transfer_planning. | yes |  | planning_affects_recipe | no | no | pixels | no_raw_prompt,no_generated_asset,no_sample_pixels,no_sample_audio,no_sample_video_upload |
| natural_edit | deterministic_planner | no | Primary provider selected for natural_edit. | no | natural_edit | planning_affects_recipe | no | no | pixels | no_raw_prompt,no_generated_asset,no_sample_pixels,no_sample_audio,no_sample_video_upload |
| recipe_lint | deterministic_planner | no | Primary provider selected for recipe_lint. | yes | quality_judge | quality_gate_only | no | no | no | no_raw_prompt,no_generated_asset,no_sample_pixels,no_sample_audio,no_sample_video_upload |
| provider_prompt_compilation | deterministic_planner | no | Primary provider selected for provider_prompt_compilation. | no | aigc_fill | generation_affects_assets | no | no | pixels | no_raw_prompt,no_generated_asset,no_sample_pixels,no_sample_audio,no_sample_video_upload |
| gap_repair_ranking | deterministic_planner | no | Primary provider selected for gap_repair_ranking. | yes |  | planning_affects_recipe | no | no | pixels | no_raw_prompt,no_generated_asset,no_sample_pixels,no_sample_audio,no_sample_video_upload |
| structure_explanation | deterministic_planner | no | Primary provider selected for structure_explanation. | no | demo_report | read_only_report | no | no | no | no_raw_prompt,no_generated_asset,no_sample_pixels,no_sample_audio,no_sample_video_upload |
| version_strategy_planning | deterministic_planner | no | Primary provider selected for version_strategy_planning. | no | multi_version | planning_affects_recipe | no | no | pixels | no_raw_prompt,no_generated_asset,no_sample_pixels,no_sample_audio,no_sample_video_upload |
| video_critic | deterministic_planner | no | Primary provider selected for video_critic. | no | quality_judge | quality_gate_only | no | no | no | no_raw_prompt,no_generated_asset,no_sample_pixels,no_sample_audio,no_sample_video_upload |
| technique_atom_kb_curator | keyword_filter | no | Primary provider selected for technique_atom_kb_curator. | no | knowledge_retrieval | read_only_report | no | no | no | no_raw_prompt,no_generated_asset,no_sample_pixels,no_sample_audio,no_sample_video_upload |
| asr | faster_whisper | no | Primary provider selected for asr. | yes | analysis | planning_affects_recipe | audio | no | pixels | no_raw_prompt,no_generated_asset,no_sample_pixels,sample_audio,no_sample_video_upload |
| ocr | easyocr_current | no | Primary provider selected for ocr. | yes | analysis | planning_affects_recipe | pixels | no | pixels | no_raw_prompt,no_generated_asset,sample_pixels,no_sample_audio,no_sample_video_upload |
| visual_grounding | opencv_flow_ocr_heuristic | no | Primary provider selected for visual_grounding. | yes | analysis | planning_affects_recipe | pixels+audio | no | pixels | no_raw_prompt,no_generated_asset,sample_pixels,sample_audio,no_sample_video_upload |
| audio_analysis | ffmpeg_librosa_audio_analysis | no | Primary provider selected for audio_analysis. | yes | analysis | audio_affects_final_mix | audio | no | audio | no_raw_prompt,no_generated_asset,no_sample_pixels,sample_audio,no_sample_video_upload |
| image_fill | deterministic_local_image_fill | no | Primary provider selected for image_fill. | no | aigc_fill | generation_affects_assets | no | no | pixels | no_raw_prompt,provenance_required,no_sample_pixels,no_sample_audio,no_sample_video_upload |
| video_fill | remotion_procedural_motion | no | Primary provider selected for video_fill. | no | render | rendering_affects_pixels | no | no | pixels | no_raw_prompt,no_generated_asset,no_sample_pixels,no_sample_audio,no_sample_video_upload |
| voiceover | procedural_synth | no | Primary provider selected for voiceover. | no | aigc_fill | generation_affects_assets | no | no | audio | no_raw_prompt,provenance_required,no_sample_pixels,no_sample_audio,no_sample_video_upload |
| sound_effect | procedural_synth | no | Primary provider selected for sound_effect. | no | aigc_fill | generation_affects_assets | no | no | audio | no_raw_prompt,provenance_required,no_sample_pixels,no_sample_audio,no_sample_video_upload |
| music | procedural_synth | no | Primary provider selected for music. | no | aigc_fill | generation_affects_assets | no | no | audio | no_raw_prompt,provenance_required,no_sample_pixels,no_sample_audio,no_sample_video_upload |
| audio_cleanup | skip_with_warning | no | Primary provider selected for audio_cleanup. | no | aigc_fill | audio_affects_final_mix | no | no | no | no_raw_prompt,no_generated_asset,no_sample_pixels,no_sample_audio,no_sample_video_upload |
| dubbing | skip_with_warning | no | Primary provider selected for dubbing. | no | aigc_fill | audio_affects_final_mix | no | no | no | no_raw_prompt,no_generated_asset,no_sample_pixels,no_sample_audio,no_sample_video_upload |
| knowledge_retrieval | keyword_filter | no | Primary provider selected for knowledge_retrieval. | no | knowledge_retrieval | planning_affects_recipe | no | no | pixels | no_raw_prompt,no_generated_asset,no_sample_pixels,no_sample_audio,no_sample_video_upload |
| quality_judge | deterministic_gates | no | Primary provider selected for quality_judge. | yes | quality_judge | quality_gate_only | no | no | no | no_raw_prompt,no_generated_asset,no_sample_pixels,no_sample_audio,no_sample_video_upload |
