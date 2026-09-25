# Keryx — Tameion builder showcase & fireside preparation

Prepared September 25, 2026. Draft for Tang Minh Vu to review; not sent to the organizer.

## Ghi chú trước khi gửi

- Phần email bên dưới là bản tiếng Anh để chỉnh và gửi Aljosa. Phần luyện nói và ghi chú nguồn không nằm trong email.
- Xác nhận câu 1 về nền tảng cá nhân; chưa thêm số năm kinh nghiệm, công việc hoặc dự án trước Keryx vì chưa có thông tin xác nhận.
- Câu 5 là quan điểm được đề xuất để bạn duyệt. Câu 6 có thể bổ sung địa điểm hoặc bỏ vì không bắt buộc.
- Xác nhận X handle và xem lại video cũ trước khi gửi. Video là bản demo trước đây, không phải demo Keryx Operator đã hoàn thành.
- Keryx hiện có nền tảng nghiên cứu và thanh toán trên Arc testnet. Keryx Operator là hướng phát triển cho Tameion; không giới thiệu toàn bộ vòng vận hành đó như tính năng đã hoàn tất.
- Không đưa số tiền giải thưởng hoặc nội dung trao đổi riêng với người tổ chức vào bản công khai này. Không có số liệu doanh thu, lợi nhuận hoặc khách hàng chưa được xác minh.

## Email — written builder showcase

**Subject: Keryx — builder showcase answers**

Hi Aljosa,

Thanks again for the invitation and for sending the questions ahead of time. Here are my showcase answers, along with the project links and a demo.

### 1. What is your dev background? What type of projects have you worked on? Preferred tech stack?

I’m an independent builder focused on AI agents and on-chain payments. My main project is Keryx, which brings together research, paid content, and creator rewards.

For Keryx, I work with TypeScript, Next.js, React, and SQLite, with Solidity for the source registry. I enjoy working across the whole product: the interface, the agent’s decisions, and what happens when a payment or request fails.

### 2. How did you realize it was a problem worth solving? And what was the moment you knew it worked for a real user, not just in a demo?

The question behind Keryx was simple: if an AI answer depends on someone’s work, how does that person get paid? A citation gives credit, but it does not necessarily bring a reader or income back to the author.

I wanted to connect those two things. Give an agent a question and a budget, let it choose which sources are worth buying, and reward the creators whose work supports its answer.

Since Lepton, I’ve also worked on the buyer’s side: purchasing a research job, seeing what was delivered, and recovering it if the connection fails. Owner-operated pilots on Arc testnet have helped me validate those flows and uncover problems that a smooth demo would miss.

I don’t yet have a verified independent-customer story that I would present as proof of repeat demand. The next milestone is people returning with real research tasks because the result is useful enough to pay for again.

### 3. What was the hardest problem inside it that nobody outside would guess was hard?

Handling uncertainty around payments.

If a request times out, the payment might still have succeeded. Retrying immediately could charge twice; marking it as failed could also be wrong. The system needs to preserve that uncertainty, keep the spending limits intact, and recover the original job.

The visible part is an agent buying a source. The difficult part is keeping the answer, the budget, and the payment record consistent when something breaks halfway through.

### 4. What did you get wrong at first, and what did it cost you to find out?

An early fallback treated sources the agent had read as sources it should reward when the model returned no citations.

A testnet run exposed the problem: the answer did not have enough supporting evidence, yet the fallback still promoted the sources into citations and paid rewards. Buying access to a source and using it as evidence are different things.

I had to rework the reward logic so that citations need an exact quotation checked against content the agent actually read before they can qualify. That check does not prove every claim is true, but it prevents an unsupported citation from automatically authorizing a reward.

The cost was incorrect testnet rewards and additional engineering work. It taught me that a model’s output should be a proposal; the application must enforce the rules around money.

### 5. Any hot takes on software development, or a stance you’re passionate about?

An agent’s spending decisions should be as inspectable as its answers.

If it buys information, I want to know why that source was worth the cost. If it stops, I want to know what is still missing. And if a payment is uncertain, the system should preserve that uncertainty instead of showing a convenient success message.

An agent that spends nothing can be doing its job well. That matters even more when it is managing part of a business on someone else’s behalf.

### 6. Where in the world are you building from? (Optional)

[Add your city and country, or omit this answer.]

### 7. What do you need right now that our audience could help with?

I’m looking for a few small teams with recurring research needs who would be willing to work through real tasks with me.

I want to learn what makes the result useful enough to pay for again, and what they need to trust the service. I’m also looking for publishers with relevant specialist content, and agent developers who could use Keryx inside an existing workflow.

Introductions to small research businesses or teams already paying for information and APIs would be particularly helpful.

- Website: https://keryx.cc
- Research workspace: https://keryx.cc/research
- GitHub: https://github.com/tang-vu/keryx
- Technical demo: https://youtu.be/De22GVl2KnY
- X: https://x.com/tangvu_dev

The video shows an earlier version of Keryx; the website reflects the current product. The payment flows discussed here use Arc testnet.

### A little context on what comes next

After Lepton, the Canteen team encouraged me to keep building and turn Keryx into a real business. That made the next challenge clearer: who needs the research repeatedly, what makes an answer worth paying for, and whether the service can cover its costs while paying contributors correctly.

For Tameion, I want to build toward Keryx Operator, the financial operations layer for that business. It would help manage incoming payments, source and service budgets, publisher obligations, and payment reconciliation, with clear limits on what the agent can decide.

The question is: can an agent run the business behind its research?

My longer-term goal is to serve paying users on mainnet. The immediate work is to validate demand and complete the operational and safety work needed to support them responsibly.

Looking forward to our conversation on October 2!

Best,
Tang Minh Vu

## Fireside — bản luyện nói

Lịch đã chốt qua email: Friday, October 2, 2026, 9:00 ET / 20:00 Hanoi, khoảng 20 phút.

Đây là câu hỏi luyện tập dựa trên showcase và chủ đề sự kiện. Aljosa sẽ gửi danh sách chính thức trước buổi nói chuyện; không coi phần này là danh sách đã được người tổ chức xác nhận.

Mỗi câu trả lời nên khoảng 30–60 giây, rồi để Aljosa dẫn tiếp. Nhớ ý chính thay vì học thuộc từng chữ.

### Opening — khoảng 30 giây

Hi, I’m Tang. I’m building Keryx, a research agent that pays creators when it uses their work.

You give it a question and a budget. It decides what to read, explains its choices, and produces an answer with citations.

For Tameion, I want to take the next step: helping the agent manage the business behind that research.

### What happened to Keryx after Lepton?

After Lepton, I kept building the parts around the research agent.

I worked on evidence checks, buyer recovery, and making payment states visible. Keryx also has research packages and receipts that connect the answer to its sources and payments.

The Canteen team encouraged me to turn it into a real business. That made me think more about who comes back, what each job costs, and what makes the result worth paying for.

That is where Keryx Operator comes from.

### What is Keryx Operator?

It is the financial operations layer I want to build for Keryx.

The goal is to manage incoming payments, plan spending on sources and services, track what publishers are owed, and reconcile payments.

Money owed to publishers should stay separate from money available for operating expenses. The agent should act within clear limits and ask me when a decision exceeds its authority.

### What would the agent actually decide?

It should decide whether a source or service is worth buying within the available budget.

If costs rise, it could choose a different research plan before making new commitments. If the available funds are insufficient, it should stop or ask for approval.

Once money is owed to a publisher, changing the plan should not make that obligation disappear.

### Why is this a business problem?

Every research job has a buyer, a result, and costs. Those costs can include information, model calls, and the work needed to recover from failures.

I need to understand whether the result is useful enough for someone to buy again, and whether the service can cover those costs while paying contributors correctly.

Keryx Operator is meant to help manage that flow. Repeat demand still has to be validated with users.

### What was the hardest technical lesson?

A timeout does not always mean a payment failed.

If the agent pays again immediately, it could pay twice. So the system needs to keep the payment in an uncertain state and check what happened before trying again.

That sounds like a small detail, but it matters whenever an agent can spend money.

### What did you get wrong?

An early fallback rewarded sources the agent had read even when the answer did not have enough supporting evidence.

I changed that so a citation needs a quotation checked against the content before it can qualify for a reward.

The lesson was simple: the model can propose an action, but the application must enforce the rules.

### Do you have real users or revenue yet?

I have validated the research and payment flows through owner-operated testnet pilots. I keep that separate from independent customer adoption and mainnet revenue.

The next milestone is repeat use for actual research needs. I want to work with a small group of users and learn what would make them pay for the result again.

### What about mainnet?

Serving paying users on mainnet is a goal. I am not presenting the current testnet activity as mainnet revenue.

I need to validate demand and complete the release checks before making that move. The important outcome is a service people can rely on and want to keep using.

### What is new for Tameion?

The existing research engine and payment flows are the starting point.

For Tameion, I want to focus on the operating cycle: receiving payments, understanding available funds and obligations, making bounded spending decisions, and recording what happened.

I will separate what already existed from what I build and validate during the event.

### What would help you most right now?

People bringing recurring research tasks.

I’d like to work with a few small teams, understand what they need, and see whether Keryx helps enough for them to return.

Introductions to publishers and agent developers who could be part of that workflow would also help.

### Closing

Lepton helped me build the research-and-payment loop. Tameion is the next step: turning that into a useful service with a business behind it.

I’m grateful for the support, and I want to keep building something people actually use.

### Câu dùng khi cần thêm thời gian hoặc nghe chưa rõ

- “Could you repeat that a little more slowly?”
- “Do you mean the technical side or the business side?”
- “Let me think for a moment.”
- “I haven’t validated that yet.”
- “That is part of the plan, but it is not finished yet.”
- “Could we skip this one and move to the next question?”

## Bối cảnh Tameion và giới hạn phát biểu

Theo trang chi tiết được đọc ngày September 25, 2026:

- RFB 04, Autonomous Business Operator, là hướng gần Keryx Operator nhất. RFB là gợi ý, không phải track bắt buộc.
- Tỷ trọng hướng dẫn: agency 30%, traction 30%, Circle tool usage 20%, innovation 20%.
- Doanh nghiệp hoặc dự án nguồn mở của chính builder có thể được tính nếu giải quyết nhu cầu thật. Điều này không biến dữ liệu tổng hợp hoặc giao dịch tự tạo để tăng số lượng thành bằng chứng nhu cầu.
- Testnet USDC được chấp nhận; người dùng thực giao dịch mainnet được đánh giá cao hơn. Điều này không phải yêu cầu bỏ qua điều kiện an toàn hoặc quyền phê duyệt triển khai mainnet.
- Dự án cũ được tiếp tục, nhưng phần tiến bộ về sản phẩm và người dùng trong thời gian Tameion phải được phân biệt với baseline.
- Trang chi tiết ghi 5 RFB và $40K; bản Luma được cung cấp ghi 6 RFB và $50K. Không đưa con số đang lệch vào showcase.
- Hạn trên website: October 10, 11:59 PM ET, tương ứng October 11, 10:59 AM tại Việt Nam. Luma hiển thị kết thúc 10:30 AM; nên đặt hạn nộp nội bộ sớm hơn cả hai.
- Fireside là buổi trò chuyện trong chương trình, tách biệt với video nộp bài hackathon dưới 3 phút.

Không tuyên bố toàn bộ Keryx Operator đã triển khai, giới hạn chi tiêu mới đã được contract thực thi, đã có lợi nhuận, hoặc đã có mainnet customers nếu chưa có bằng chứng tương ứng. Không dùng tổng thanh toán lịch sử như số khách hàng độc lập.

## Nguồn tham chiếu

- [Tameion: RFBs, judging, FAQ, submission](https://tameion.thecanteenapp.com/)
- [Canteen — Agents and Ledgers in 2026](https://thecanteenapp.com/analysis/2026/09/12/agents-and-ledgers.html)
- [Keryx business model](./business-model.md): kịch bản chi phí và điểm hòa vốn không phải kết quả kinh doanh thực tế.
- [Product and mainnet delivery](./mainnet-delivery-plan.md): phân biệt pilot, nhu cầu độc lập và điều kiện mainnet.
- [Citation rewards engineering note](./engineering/2026-09-08-citation-rewards.md): kiểm tra bằng chứng và giới hạn của việc kiểm tra.
- [Decision history](../DECISIONS.md): bài học fallback citation và thay đổi vận hành.

Email từ người tổ chức và bối cảnh đăng ký do chủ dự án cung cấp được dùng để chuẩn bị bản nháp; không chép lại trao đổi riêng vào tài liệu này.
