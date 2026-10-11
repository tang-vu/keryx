/** Fixed development set for the lexical draft check. Every passage and source is
 * synthetic text written for this repository and labelled by its author; no real
 * paper, expert reviewer or held-out sample is represented. The set deliberately
 * keeps cases a wording comparison is known to get wrong. */

export type EvaluationLabel = "supported" | "partly-supported" | "not-found";
export interface DraftCheckEvaluationCase {
  id: string;
  /** One sentence of a draft, without its citation marker. */
  claim: string;
  /** Text supplied for the single cited source. */
  source: string;
  expected: EvaluationLabel;
  /** Why an unsupported or partial case is hard, where that is the point of the case. */
  trap?: "negation" | "opposite-direction" | "different-number" | "role-reversal" | "certainty" | "population" | "causation" | "different-topic" | "extra-detail" | "paraphrase";
}

const CONTEXT = "The study was preregistered and all materials are archived. Participants gave written consent before enrolment.";

export const DRAFT_CHECK_EVALUATION_CASES: readonly DraftCheckEvaluationCase[] = [
  // Supported: the source states the claim in close wording.
  { id: "s01", expected: "supported", claim: "Retrieval augmentation improved exact-match accuracy on open-domain questions.",
    source: `${CONTEXT} Retrieval augmentation improved exact-match accuracy on open-domain questions by a wide margin. Latency rose slightly.` },
  { id: "s02", expected: "supported", claim: "The treatment group reported lower anxiety scores after eight weeks.",
    source: `After eight weeks, the treatment group reported lower anxiety scores than controls. ${CONTEXT}` },
  { id: "s03", expected: "supported", claim: "Median household income fell by 4.2 percent between 2008 and 2010.",
    source: "Between 2008 and 2010, median household income fell by 4.2% in the surveyed regions. Employment recovered later." },
  { id: "s04", expected: "supported", claim: "Larger batch sizes reduced the variance of gradient estimates.",
    source: "We find that larger batch sizes reduce the variance of gradient estimates, as expected from theory." },
  { id: "s05", expected: "supported", claim: "Soil moisture was the strongest predictor of seedling survival.",
    source: "Across all plots, soil moisture was the strongest predictor of seedling survival. Canopy cover had a weaker effect." },
  { id: "s06", expected: "supported", claim: "No significant difference in recall was observed between the two interfaces.",
    source: "We observed no significant difference in recall between the two interfaces. Completion time did differ." },
  { id: "s07", expected: "supported", claim: "The vaccine reduced hospital admissions among adults over 65.",
    source: "In the surveillance cohort, the vaccine reduced hospital admissions among adults over 65 during the winter season." },
  { id: "s08", expected: "supported", claim: "Remote workers reported higher job satisfaction than office workers.",
    source: "Survey responses show that remote workers reported higher job satisfaction than office workers in every sector sampled." },
  { id: "s09", expected: "supported", claim: "The catalyst retained 91 percent of its activity after 50 cycles.",
    source: "Stability tests showed the catalyst retained 91% of its activity after 50 cycles. Surface area declined modestly." },
  { id: "s10", expected: "supported", claim: "Sleep deprivation impaired working memory performance.",
    source: "Consistent with earlier reports, sleep deprivation impaired working memory performance in both age groups." },
  { id: "s11", expected: "supported", trap: "paraphrase", claim: "Students who received weekly feedback finished more assignments.",
    source: "Learners given feedback every week completed a greater number of homework tasks than the comparison class." },
  { id: "s12", expected: "supported", trap: "paraphrase", claim: "The policy did not change smoking rates among teenagers.",
    source: "Adolescent tobacco use was unaffected by the regulation over the observation window." },
  { id: "s13", expected: "supported", claim: "Urban heat islands raise night-time temperatures more than daytime temperatures.",
    source: "Urban heat islands raise night-time temperatures more than daytime temperatures, a pattern seen in all twelve cities." },
  { id: "s14", expected: "supported", claim: "Fine-tuning on 500 labelled examples matched the fully supervised baseline.",
    source: "Surprisingly, fine-tuning on only 500 labelled examples matched the fully supervised baseline on this benchmark." },

  // Partly supported: the source supports the core statement but not one stated detail.
  { id: "p01", expected: "partly-supported", trap: "extra-detail", claim: "The drug lowered blood pressure by 12 mmHg in patients with diabetes.",
    source: "The drug lowered blood pressure in patients with diabetes. Dosage was adjusted for body weight." },
  { id: "p02", expected: "partly-supported", trap: "extra-detail", claim: "Wind capacity doubled in coastal provinces because of new subsidies.",
    source: "Wind capacity doubled in coastal provinces during the decade. Grid connections remained a bottleneck." },
  { id: "p03", expected: "partly-supported", trap: "extra-detail", claim: "The model generalised to unseen languages and outperformed human annotators.",
    source: "The model generalised to unseen languages with only a modest drop in accuracy." },
  { id: "p04", expected: "partly-supported", trap: "extra-detail", claim: "Bee abundance increased in restored meadows within three years across all 40 sites.",
    source: "Bee abundance increased in restored meadows within three years. Butterfly counts were unchanged." },

  // Not supported by the cited text.
  { id: "u01", expected: "not-found", trap: "negation", claim: "The intervention reduced readmission rates in elderly patients.",
    source: "The intervention did not reduce readmission rates in elderly patients. Length of stay was similar." },
  { id: "u02", expected: "not-found", trap: "negation", claim: "Fertiliser use was not associated with nitrate levels in groundwater.",
    source: "Fertiliser use was associated with nitrate levels in groundwater at every monitoring well." },
  { id: "u03", expected: "not-found", trap: "opposite-direction", claim: "Minimum wage increases decreased teenage employment in the region.",
    source: "Minimum wage increases increased teenage employment in the region over the following year." },
  { id: "u04", expected: "not-found", trap: "opposite-direction", claim: "The new alloy showed higher fatigue resistance than the reference alloy.",
    source: "The new alloy showed lower fatigue resistance than the reference alloy under cyclic loading." },
  { id: "u05", expected: "not-found", trap: "different-number", claim: "The sample included 1,200 participants from 14 countries.",
    source: "The sample included 320 participants from 6 countries. Recruitment ran for two years." },
  { id: "u06", expected: "not-found", trap: "different-number", claim: "Error rates dropped to 3 percent after calibration.",
    source: "Error rates dropped to 13 percent after calibration, still above the target." },
  { id: "u07", expected: "not-found", trap: "different-topic", claim: "Glacier retreat accelerated sharply after 1990.",
    source: "Our survey measured reading comprehension in primary schools. Scores were stable across cohorts." },
  { id: "u08", expected: "not-found", trap: "different-topic", claim: "Remote sensing identified illegal mining sites with high precision.",
    source: "The article reviews tax policy in federal systems. It does not present field data." },
  { id: "u09", expected: "not-found", trap: "role-reversal", claim: "The transformer model outperformed the recurrent model on translation.",
    source: "The recurrent model outperformed the transformer model on translation in the low-resource setting." },
  { id: "u10", expected: "not-found", trap: "role-reversal", claim: "Predators were more abundant than prey in the reserve.",
    source: "Prey were more abundant than predators in the reserve throughout the survey." },
  { id: "u11", expected: "not-found", trap: "certainty", claim: "Vitamin D supplementation prevents respiratory infections.",
    source: "Whether vitamin D supplementation prevents respiratory infections remains unknown and requires further trials." },
  { id: "u12", expected: "not-found", trap: "population", claim: "The therapy improved mobility in children with cerebral palsy.",
    source: "The therapy improved mobility in adult stroke patients. No paediatric participants were enrolled." },
  { id: "u13", expected: "not-found", trap: "causation", claim: "Social media use causes depression in adolescents.",
    source: "Social media use was correlated with depression in adolescents; the design cannot establish that it causes it." },
  { id: "u14", expected: "not-found", trap: "different-topic", claim: "Cover crops increased maize yields in dry years.",
    source: "Cover crops were planted in autumn. Maize was harvested in late summer. Dry years were excluded from the analysis." },
  { id: "u15", expected: "not-found", trap: "negation", claim: "The algorithm converges for all convex objectives.",
    source: "The algorithm fails to converge for some convex objectives, as the counterexample in Section 4 shows." },
  { id: "u16", expected: "not-found", trap: "different-number", claim: "Adoption reached 70 percent of households by 2015.",
    source: "Adoption reached 70 percent of households by 2021, six years later than planned." },
  { id: "u17", expected: "not-found", trap: "opposite-direction", claim: "Class size reductions had a positive effect on test scores.",
    source: "Class size reductions had a negative effect on test scores in the first year of the programme." },
  { id: "u18", expected: "not-found", trap: "certainty", claim: "The coating eliminates bacterial growth on steel surfaces.",
    source: "The authors hypothesise that the coating eliminates bacterial growth on steel surfaces but did not test it." },
  // Second batch, written before the final rule revision and not used to adjust it.
  { id: "s15", expected: "supported", claim: "Mangrove restoration reduced coastal erosion at the monitored sites.",
    source: "Shoreline surveys indicate that mangrove restoration reduced coastal erosion at the monitored sites over five years." },
  { id: "s16", expected: "supported", claim: "Response times were faster with the redesigned dashboard.",
    source: "Operators completed tasks sooner: response times were faster with the redesigned dashboard in all three shifts." },
  { id: "s17", expected: "supported", trap: "paraphrase", claim: "Older adults were less likely to adopt mobile banking.",
    source: "Uptake of banking apps on phones declined steadily with respondent age." },
  { id: "s18", expected: "supported", claim: "The alloy's conductivity may decrease at temperatures above 400 kelvin.",
    source: "Measurements suggest the alloy's conductivity may decrease at temperatures above 400 kelvin." },
  { id: "p05", expected: "partly-supported", trap: "extra-detail", claim: "Tutoring improved mathematics scores for girls and boys in rural and urban schools.",
    source: "Tutoring improved mathematics scores for girls and boys. The sample was drawn from one district." },
  { id: "p06", expected: "partly-supported", trap: "extra-detail", claim: "Emissions fell by 18 percent after the carbon tax was introduced in 2019.",
    source: "Emissions fell after the carbon tax was introduced. The size of the effect is debated." },
  { id: "u19", expected: "not-found", trap: "role-reversal", claim: "Exports to the northern bloc exceeded imports from it.",
    source: "Imports from the northern bloc exceeded exports to it in every quarter." },
  { id: "u20", expected: "not-found", trap: "population", claim: "The app increased physical activity among office workers.",
    source: "The app increased physical activity among retired volunteers in a small pilot." },
  { id: "u21", expected: "not-found", trap: "negation", claim: "Screening lowered mortality from the disease.",
    source: "Screening had no measurable influence on mortality from the disease in the ten-year follow-up." },
  { id: "u22", expected: "not-found", trap: "certainty", claim: "The compound cures the infection in humans.",
    source: "The compound might cure the infection in humans, but only mouse data are available so far." },
  { id: "u23", expected: "not-found", trap: "different-number", claim: "The survey covered 45 schools.",
    source: "The survey covered 54 schools in two provinces." },
  { id: "u24", expected: "not-found", trap: "different-topic", claim: "Subsidies increased electric vehicle sales in northern cities.",
    source: "Electric vehicle owners in northern cities were interviewed about charging habits. Subsidies were not studied." },
  { id: "u25", expected: "not-found", trap: "opposite-direction", claim: "Tariffs strengthened domestic steel producers.",
    source: "Tariffs weakened domestic steel producers by raising input costs." },
  { id: "u26", expected: "not-found", trap: "causation", claim: "Coffee consumption lowers the risk of liver disease.",
    source: "Coffee consumption was linked with lower risk of liver disease in observational cohorts, which cannot show that coffee lowers risk." },
];
