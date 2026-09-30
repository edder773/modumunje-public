import { expect, test } from "@playwright/test";

const assets = [
  "s1_t001_agile_overview.png",
  "s1_t002_asis_analysis_map.png",
  "s1_t003_elicitation_methods.png",
  "s1_t003_requirement_flow.png",
  "s1_t004_traceability_matrix.png",
  "s1_t005_dfd_elements.png",
  "s1_t005_hipo_structure.png",
  "s1_t006_uml_overview.png",
  "s1_t006_usecase_example.png",
  "s1_t007_ui_principles.png",
  "s1_t008_fidelity_progression.png",
  "s1_t008_storyboard_map.png",
  "s1_t009_screen_flow.png",
  "s1_t009_form_feedback.png",
  "s1_t010_accessibility_responsive.png",
  "s1_t011_modularization.png",
  "s1_t012_architecture_styles.png",
  "s1_t013_oop_solid.png",
  "s1_t014_coupling_cohesion.png",
  "s1_t014_fanin_fanout.png",
  "s1_t015_gof_map.png",
  "s1_t016_interface_spec.png",
  "s1_t016_data_mapping.png",
  "s1_t017_integration_matrix.png",
  "s1_t017_middleware_types.png",
  "s1_t018_error_flow.png",
  "s1_t018_log_fields.png",
];

test("reviewed S1 learning images are served from their permanent learning paths", async ({ request }) => {
  for (const name of assets) {
    const response = await request.get(
      `/learning-assets/information-processing/software-design/${name}`,
    );
    expect(response.status(), name).toBe(200);
    expect(response.headers()["content-type"], name).toContain("image/png");
    expect((await response.body()).subarray(0, 8).toString("hex"), name).toBe("89504e470d0a1a0a");
  }
});
