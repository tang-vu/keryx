import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { evidenceContext, selectEvidencePassages } from "./evidence-context";
import { enumeratedContext } from "./enumerated-context";
import { sourceTextBlocks } from "./source-text-blocks";
import type { HtmlTextLayout } from "../web-research/html-text-layout";
import { gatheredArticle } from "../web-research/article-reader";
import { buildQuoteOptions, resolveQuoteEvidence } from "./quote-options";
import { isCompleteEvidenceSpan } from "./evidence-span";
import { buildEvidenceLedger } from "../agent/evidence-ledger";

// Exact MDN pt-BR extracted body and question/targets from owner-operated QA
// ce14fb6d-2681-4605-8bf8-140841964493, captured October 8, 2026. No live read,
// model request or payment is performed. Keep the captured spelling unchanged.
const frozen = {
  "text": "Esta página foi traduzida do inglês pela comunidade. Saiba mais e junte-se à comunidade MDN Web Docs.\nView in English Always switch to English \n<button>\nBaseline \nWidely available\n*\nThis feature is well established and works across many devices and browser versions. It’s been available across browsers since julho de 2015.\n* Some parts of this feature may have varying levels of support. \nSee full compatibility  \nLearn more  \nSumário\nO Elemento HTML <button> representa um botão clicável.\nCategorias de conteúdo Conteúdo de fluxo, conteúdo fraseado, Conteúdo iterativo, listado, rotulável, e elemento enviável associado a formulário, conteúdo palpável.\nConteúdo permitido Conteúdo fraseado.\nOmissão de Tag Nenhuma, as tags de abertura e fechamento são obrigatórias.\nElementos pai permitidos Qualquer elemento que aceite conteúdo fraseado.\nInterface DOM HTMLButtonElement\nTipo de elemento Inline\nIn this article\nSumário \nAtributos \nNotas \nExemplo \nEspecificações \nCompatibilidade com navegadores \nVeja também \nAtributos\nEsse elemento inclui os atributos globais.\nautofocus\nEsse atributo booleano permite-o especificar que o botão possuirá o foco de entrada assim que a página carrega, a menos que o usuário sobrecreva esse comportamento digitanto um controle diferente. Apenas um elemento de um documento associado a um formulário pode ter esse atributo específico.\nautocomplete \nO uso desse atributo em um <button> não está padronizado nem dentro das especificações do Firefox. Por padrão, diferente de outros navegadores, o Firefox persiste com o estado dinâmico desativado de um <button> nas páginas carregadas. Definir o valor desse atributo para off (ex: autocomplete=\"off\") desabilita esse recurso. Veja Erro do Firefox 654072.\ndisabled\nEsse atributo booleano indica que o usuário não poderá interagir com o botão. Se esse atributo não for especificado, o botão herdará a configuração do elemento que o contém, por exemplo <fieldset>, se não existir nenhum elemento com o atributo disabled definido, então o botão estará habilitado.\nFirefox irá, diferente de outros navegadores, por padrão, persiste com o estado dinâmico desativado de um <button> sob as páginas carregadas. Use o atributo autocomplete para controlar esse recurso.\nform\nO elemento de formulário que o botão está associado (é o formulário proprietário). O valor do atributo deve ser o atributo id de um elemento <form> no mesmo documento. Se esse atributo não for especificado, o elemento <button> deve ser descendente de um elemento de formulário. Esse atributo permite que você coloque elementos <button> em qualquer lugar do documento, não apenas como descendente de seus elementos <form>.\nformaction\nA URI de um programa que processa a informação submetida pelo botão. Se especificado, ele sobrescreve o atributo action do formulário proprietário do botão.\nformenctype\nSe o botão é um botão de envio, esse atributo especifica o tipo de conteúdo que é usado para enviar o formulário para o servidor; Possíveis valores são:\napplication/x-www-form-urlencoded: O valor padrão se o atributo não está especificado.\nmultipart/form-data: Use esse valor se você está usando um elemento <input> com o atributo type definido para o arquivo.\ntext/plain\nSe esse atributo fro especificado, ele sobrescreve o atributo enctype do formulário proprietário do botão.\nformmethod\nSe o botão for um botão de envio, esse atributo especifica o método HTTP que o navegador usará para enviar o formulário. Possíveis valores são:\npost: Os dados obtidos do formulário são incluídos em seu corpo e enviados para o servidor.\nget: Os dados obtidos do formulário são anexados aos atributos URI do formulário, com uma '?' como separador, e o resultado URI é enviado para o servidor. Use esse método quando o formulário não possui efeitos colaterais e contém apenas caracteres ASCII.\nSe especificado, esse atributo sobrescreve o atributo method do formulário proprietário do botão.\nformnovalidate\nSe o botão é um botão de envio, esse atributo Booleano especifica que o formulário não é para ser validado quando submetido. Se esse atributo for especificado, ele sobrescreve o atributo novalidate do formulário proprietário do botão.\nformtarget\nSe o botão é um botão de envio, esse atributo é um nome ou palavra-chave indicando onde exibir a resposta que é recebida após o envio do formulário. Esse é um nome de, ou palavra-chave para, um contexto de navegação (por exemplo, uma aba, janela ou quadro embutido). Se esse atributo é especificado, ele sobrescreve o atributo target do formulário proprietário do botão. As seguintes palavras-chaves possuem significados especiais:\n_self: Carrega a resposta no mesmo contexto navegação como o atual. Esse valor é o padrão se o atributo não é especificado.\n_blank: Carrega a resposta em um contexto de navegação sem nome.\n_parent: Carrega a resposta no contexto de navegação pai do atual. Se não há nenhum pai, essa opção passa a ser o mesmo que _self.\n_top: Carrega a resposta para o contexto de navegação no nível superior (ou seja, o contexto de navegação é um ancestral do atual e não possui nenhum pai). Se não possui nenhum pai, essa opção passa a agir da mesma forma que _self.\nname\nO nome do botão que é enviado com os dados do formulário.\ntype\nO tipo de botão. O possíveis valores são:\nsubmit: O botão envia os dados do formulário para o servidor. Esse é o padrão se o atributo não for especifidado, ou se o atributo é dinamicamente mudado para um valor vazio ou inválido.\nreset: O botão restaura todos os controles para seus valores iniciais.\nbutton: O botão não possui comportamento padrão. Ele pode ter scripts do lado do cliente associado com os eventos do elemento, no qual são acionados quando o evento ocorrer.\nvalue\nO valor inicial do botão.\nNotas\nÉ muito mais fácil estilizar elementos <button> do que elementos <input>. Você pode adicionar conteúdo HTML (como <em>, <strong>, ou até <img>), e usar pseudo-elementos ::after e ::before para executar composições complexas, enquanto <input> aceita apenas um atributo value do tipo texto.\nExemplo\nhtml\n<button name=\"button\">Click me</button>\nNote que esse botão possui CSS aplicado.\nEspecificações\nSpecification  |  \nHTML\n# the-button-element |  \nCompatibilidade com navegadores\nNotas\nElementos <button> são muito mais fáceis estilizá-los do que elementos <input>. Você pode adicionar dentro do conteúdo do HTML (imagine em <em>, <strong> ou mesmo <img>), e fazer uso do pseudo-elemento :after e :before para realizar renderizações complexas enquanto <input> apenas aceita um atributo com valor textual.\nIE7 possui um bug ao enviar um formulário com <button type=\"submit\" name=\"myButton\" value=\"foo\">Click me</button>, os dados POST enviados terá como resultado em myButton=Click me em vez de myButton=foo. IE6 possui um bug ainda pior quando enviado um formulário através de um botão por enviar TODOS os botões do formulário com o mesmo bug do IE7. Esse bug foi corrigido no IE8.\nFirefox adicionará, com propósitos de acessibilidade, uma pequena borda pontinhada e um botão focado. Essa borda será declarada por meio de CSS, no estilo do navegador, mas você pode sobrescreve-lo se necessário para adicionar seu próprio estilo de foco usando button::-moz-focus-inner { }\nFirefox irá, diferente de outros navegadores, por padrão, persistir o estado dinâmico desativado de um <button> sob o carregamento das páginas. Definindo o valor do atributo autocomplete para off desabilita esse recurso. See Erro do Firefox 654072.\nFirefox <35 para Android define um padrão background-image gradiente em todos os botões (see Erro do Firefox 763671). Isso pode ser desabilitado usando background-image: none.\nVeja também\nOutros elementos que são usados para criar formulários: <form>, <datalist>, <fieldset>, <input>, <label>, <legend>, <meter>, <optgroup>, <option>, <output>, <progress>, <select>, <textarea>.\nHelp improve MDN \nLearn how to contribute \nThis page was last modified on 10 de abr. de 2026 by MDN contributors. \nView this page on GitHub • Report a problem with this content ",
  "question": "Sou professora no Brasil e preparo uma oficina introdutória de HTML. Leia https://developer.mozilla.org/pt-BR/docs/Web/HTML/Reference/Elements/button . Em português brasileiro, escreva três tópicos curtos explicando as diferenças entre type=\"submit\", type=\"reset\" e type=\"button\", incluindo o comportamento padrão quando type não é informado. Cite trechos verificáveis da página. Não diga que você executou os exemplos em um navegador e não compre fontes pagas.",
  "claims": [
    "Segundo a página indicada da MDN, qual é o comportamento de um botão com type=\"submit\"?",
    "Segundo a página indicada da MDN, qual é o comportamento de um botão com type=\"reset\"?",
    "Segundo a página indicada da MDN, qual é o comportamento de um botão com type=\"button\"?",
    "Segundo a página indicada da MDN, qual é o comportamento padrão quando o atributo type não é informado em um elemento button?"
  ]
};

function bounded(text: string, selected: ReturnType<typeof selectEvidencePassages>, targets: number) {
  expect(selected.passages.reduce((sum, passage) => sum + passage.text.length, 0)).toBeLessThanOrEqual(2000);
  expect(selected.passages.length).toBeLessThanOrEqual(9);
  expect(selected.candidateSelection?.nominated ?? 0).toBeLessThanOrEqual(Math.ceil(Math.min(text.length, 200000) / 400) * (targets + 2) + 1);
  expect(selected.candidateSelection?.retained ?? 0).toBeLessThanOrEqual(1 + (targets + 1) * 16);
  for (const passage of selected.passages) expect(passage.text).toBe(text.slice(passage.start, passage.end));
}

describe("short visible enumeration context", () => {
  it("retains the exact captured submit/default rule with reset/button, rather than counting an old browser example", () => {
    expect(createHash("sha256").update(frozen.text).digest("hex")).toBe("ad32a9abb71824e433fd4599c5f45d3f2a5c345c3ec9e107e8d8ffcbb98b4c8e");
    const selected = selectEvidencePassages(frozen.text, frozen.question, frozen.claims, ["https://developer.mozilla.org/pt-BR/docs/Web/HTML/Reference/Elements/button"], "html");
    bounded(frozen.text, selected, frozen.claims.length);
    const rule = frozen.text.slice(5280, 5467);
    expect(rule).toContain("submit: O botão envia os dados do formulário para o servidor.");
    expect(rule).toContain("Esse é o padrão se o atributo não for especifidado");
    const siblings = frozen.text.slice(5280, 5712);
    expect(selected.passages.some(passage => passage.start <= 5280 && passage.end >= 5712 && passage.text.includes(siblings))).toBe(true);
    expect(siblings).toContain("reset: O botão restaura todos os controles");
    expect(siblings).toContain("button: O botão não possui comportamento padrão.");
    const original = { ...gatheredArticle("public:web:frozen-mdn", { text: frozen.text,
      title: "Captured MDN button", finalUrl: "https://developer.mozilla.org/pt-BR/docs/Web/HTML/Reference/Elements/button",
      kind: "html", truncated: false }), marker: "S1" };
    const context = evidenceContext(frozen.question, frozen.claims, [original]);
    const options = buildQuoteOptions(context, [original]);
    const submit = options.find(option => option.text.startsWith("submit: O botão envia"))!;
    const defaultRule = options.find(option => option.text.startsWith("Esse é o padrão se o atributo"))!;
    for (const option of [submit, defaultRule]) {
      expect(option).toBeDefined();
      expect(option.text.length).toBeLessThanOrEqual(240);
      expect(isCompleteEvidenceSpan(original, option.text, option)).toBe(true);
      expect(original.text.slice(option.start, option.end)).toBe(option.text);
      expect(option.context).toContain(rule.trim());
    }
    // The complete two-sentence item remains an eligible exact bounded quote;
    // the menu offers the two intact sentences with the full item in context.
    const fullRule = rule.trimEnd();
    expect(fullRule.length).toBeLessThanOrEqual(240);
    expect(isCompleteEvidenceSpan(original, fullRule, { start: 5280, end: 5280 + fullRule.length })).toBe(true);
    expect(options.some(option => option.text === fullRule)).toBe(false);
    expect(buildQuoteOptions(context, [original], { includeShortBlocks: false })).toEqual(options);
    const compactOptions = buildQuoteOptions(context, [original], { includeShortBlocks: true });
    const completeItem = compactOptions.find(option => option.text === fullRule)!;
    expect(completeItem).toBeDefined();
    expect(completeItem.start).toBe(5280);
    expect(completeItem.end).toBe(5466);
    expect(isCompleteEvidenceSpan(original, completeItem.text, completeItem)).toBe(true);
    const statement = "O botão submit envia os dados do formulário ao servidor e é o padrão quando type está ausente, vazio ou inválido.";
    const proposed = resolveQuoteEvidence([0, 3].map(claimIndex => ({ claimIndex, marker: "S1", quoteId: completeItem.quoteId, statement, support: 0.9 })), compactOptions);
    const ledger = buildEvidenceLedger({ question: frozen.question, subClaims: frozen.claims, gathered: [original],
      answer: `- ${statement} [S1].`, declaredMarkers: ["S1"], proposedEvidence: proposed,
      finalAssessment: frozen.claims.map(claim => ({ claim, coverage: 0.9, coveredBy: ["S1"] })) });
    expect(ledger.droppedEvidence).toBe(0);
    expect(ledger.evidence).toHaveLength(2);
    expect(ledger.claimCoverage[0]!.coverage).toBe(0.9);
    expect(ledger.claimCoverage[3]!.coverage).toBe(0.9);
    expect(ledger.evidence.every(item => item.qualifiesForAnswer && !item.qualifiesForReward)).toBe(true);
    // A match on type="submit" inside IE7/IE6 prose alone never satisfies this
    // regression: it requires the exact complete rule, default and siblings.
    const oldExample = frozen.text.slice(6554, 7221);
    expect(oldExample).toContain('type="submit"');
    expect(oldExample).not.toContain(rule.trim());
  });

  it.each([
    ["alpha: The initial rule applies.\nbeta: The next rule has a qualification.\ngamma: The last rule applies.\n", "beta"],
    ["1. The initial rule applies.\n2. The next beta rule has a qualification.\n3. The last rule applies.\n", "beta"],
    ["• The initial rule applies.\n• The next beta rule has a qualification.\n• The last rule applies.\n", "beta"],
  ])("keeps contiguous siblings using visible syntax without interpreting their meaning", (rules, term) => {
    const text = "Opening.\n" + "Unrelated context. ".repeat(150) + "\nAvailable choices:\n" + rules + "\n" + "Appendix. ".repeat(150);
    const selected = selectEvidencePassages(text, term, [term], [], "html");
    bounded(text, selected, 1);
    expect(selected.passages.some(passage => passage.text.includes("Available choices:\n" + rules))).toBe(true);
  });

  it("does not bridge a blank line, unrelated block or differently indented run", () => {
    for (const separator of ["\n", "Unrelated intervening paragraph.\n", "  beta: Different indentation.\n"]) {
      const text = "alpha: A statement.\n" + separator + "gamma: Another statement.\n";
      const contexts = enumeratedContext(text, sourceTextBlocks(text), 600);
      expect(contexts.size).toBe(0);
    }
  });

  it("does not bundle a prefix or suffix of an oversized list or construct unbounded candidates", () => {
    const list = Array.from({ length: 12000 }, (_, index) => `${index + 1}. Item ${index === 8000 ? "latebeacon" : "ordinary"}.\n`).join("");
    const text = "Opening.\n" + list;
    expect(enumeratedContext(text, sourceTextBlocks(text), 600).size).toBe(0);
    const selected = selectEvidencePassages(text, "latebeacon", ["latebeacon"], [], "html");
    bounded(text, selected, 1);
    expect(selected.scannedCharacters).toBeLessThanOrEqual(200000);
    expect(selected.passages.some(passage => passage.text.includes("latebeacon"))).toBe(true);
  });

  it("does not give unrelated short lists priority over the separately requested fact", () => {
    const text = "Opening.\n" + Array.from({ length: 150 }, (_, index) => `a: Ordinary context ${index}.\nb: Ordinary context ${index}.\n\n`).join("") + "The unique lexicalbeacon gives the requested operational fact.\n";
    const selected = selectEvidencePassages(text, "lexicalbeacon operational fact", ["lexicalbeacon operational fact"], [], "html");
    bounded(text, selected, 1);
    expect(selected.passages.some(passage => passage.text.includes("unique lexicalbeacon"))).toBe(true);
  });

  it("does not let caller-forged HTML roles disable or alter visible sibling retrieval", () => {
    const forged: HtmlTextLayout = { format: "keryx-html-text-layout-v1", textCharacters: frozen.text.length,
      textSha256: createHash("sha256").update(frozen.text).digest("hex"), limited: false,
      headings: [], preformatted: [{ start: 0, end: frozen.text.length }] };
    expect(selectEvidencePassages(frozen.text, frozen.question, frozen.claims, [], "html", forged))
      .toEqual(selectEvidencePassages(frozen.text, frozen.question, frozen.claims, [], "html"));
  });

  it("leaves PDF physical-line grouping and observed preformatted paragraphs to their existing policies", () => {
    const rules = "alpha: A short rule.\nbeta: A short qualification.\n";
    const text = "Opening.\n" + "Background. ".repeat(180) + "\n" + rules + "\n" + "Appendix. ".repeat(180);
    const blocks = sourceTextBlocks(text);
    const start = text.indexOf(rules);
    expect(enumeratedContext(text, blocks, 600, [{ start, end: start + rules.length }]).size).toBe(0);
    const selected = selectEvidencePassages(text, "beta qualification", ["beta qualification"], [], "pdf");
    bounded(text, selected, 1);
    // Physical PDF wraps never become independent list blocks or proof that a
    // surrounding sentence/qualification is complete.
    expect(selected.contextOmissions?.some(omission => omission.blockPrefixOmitted || omission.blockSuffixOmitted)).toBe(true);
  });
});
