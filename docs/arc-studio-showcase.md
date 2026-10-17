# Keryx Arc Studio showcase

On October 17, 2026, Keryx's owner used Arc Studio to create and review a
standalone creator-onboarding prototype. The owner chose to retain it as a
showcase of hands-on exploration. The prototype uses synthetic state and has
not been integrated into Keryx production.

## Prototype

The [Arc Studio project](https://studio.arc.io/app/5f7e58e6-e7a5-4263-ab0d-19a1e12bd0d5)
explores five steps: source and RSS preparation, publishing-control proof,
wallet and network checks, registration, and distribution-policy review.
Its demo scenarios cover disconnected or mismatched wallets, a wrong network,
expired proof, unavailable gas sponsorship, and pending or ambiguous registration.
Viewing the workspace may require an Arc Studio sign-in.

The trial included desktop and mobile layout inspection and manual interaction
checks. Empty fields, embedded URL credentials and a feed from another origin
were rejected. Back navigation and scenario changes preserved the entered draft.
Wallet and network mismatches blocked continuation; after review corrections,
an ambiguous original remained available for inspection without a fresh submit
action. These observations apply to the simulated prototype.

Screenshots, prompts, review notes and a code export with its environment file
removed are retained in the owner's local showcase bundle. The exported app and
its dependencies are outside the production source and distribution packages.

## Lessons from the review

Arc Studio produced an interactive UI, but the generated business rules needed
comparison with Keryx's implementation. An invented 25% protocol fee was removed
after review. Remaining mismatches include a made-up proof-file format,
contradictory copy about when publishing control is verified, and inaccurate
claims about citation rewards under the Free policy.

The generated Vite, React 18 and Tailwind 3 scaffold also differs from Keryx's
Next.js, React 19 and Tailwind 4 application. The retained prototype demonstrates
tool exploration and UI ideas. It does not establish payment correctness,
on-chain settlement, independent adoption, or a production integration.

## Short introduction

**English:** I explored Arc Studio by building and reviewing a creator onboarding
prototype for Keryx. I tested desktop and mobile layouts and simulated states
such as wallet mismatch, wrong network, and pending registration. I retained it
as a standalone showcase of the experiment; Keryx's production implementation
remains unchanged.

**Tiếng Việt:** Tôi đã thử Arc Studio bằng cách dựng và đánh giá một prototype
onboarding creator cho Keryx, kiểm tra giao diện desktop/mobile và các trạng thái
mô phỏng như ví không khớp, sai mạng hay đăng ký đang chờ xử lý. Tôi lưu bản này
làm showcase trải nghiệm; phần production của Keryx giữ nguyên.
