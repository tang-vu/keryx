# Neutral Desktop labels for #276

The native Desktop renderer now uses the existing system-language selection and
explicit override for 19 neutral workspace, navigation, question, depth-heading
and library labels in English, Vietnamese, Portuguese and Spanish.

The bounded catalogue in `shared/i18n/desktop-neutral.ts` imports canonical
English values from the existing native Desktop catalogue. Its allowlist excludes
financial, consent, payment, recovery, trust and private-boundary copy. Those
messages remain canonical English pending their existing human-review requirement.
No UI locale flag, second selector or new preference store is introduced.

Changing presentation leaves original questions, answers, references, citations,
errors, amounts, task modes, status values and executable buyer commands intact.
The native bridge and task, import, purchase and recovery actions are unchanged.

The focused tests cover every allowed English value, complete immutable locale
key sets, refusal of critical or inherited keys, the real React renderer's system
selection and overrides, unchanged raw task/reference data and commands, and no
action calls when presentation changes. All 21 focused pure/real-renderer cases,
the focused Desktop typecheck and the renderer bundle stage passed. The bundle
uses the existing Desktop build options; it does not constitute a full native
package or installer build. Source handoffs stay in ignored local output.

This is a partial original #276 outcome. It does not establish human translation
approval, complete cross-surface localization, installed Desktop delivery or
settlement verification. Required CI and the coordinated release remain separate.
