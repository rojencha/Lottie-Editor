// Implementation snippets. Only reference examples for libraries whose public APIs are known; each is tied to the file
// format it actually supports. The file path is an example: the file must be hosted by the consuming project.
import { h, modal, segmented, toast, bannerEl, icon } from "../ui/dom.js";
import { safeName } from "../core/convert.js";

export function snippetsFor(fileName, format) {
  const path = `/assets/${fileName}`;
  if (format === "json") return [{
    id: "lottie-web", label: "Web — lottie-web", lang: "html", note: "lottie-web plays Lottie JSON (.json).",
    code: `<div id="anim" style="width:300px;height:300px"></div>\n<script src="https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js"></script>\n<script>\n  lottie.loadAnimation({\n    container: document.getElementById("anim"),\n    renderer: "svg",\n    loop: true,\n    autoplay: true,\n    path: "${path}"\n  });\n</script>`,
  }];
  return [{
    id: "dotlottie-web", label: "Web — dotLottie Web", lang: "js", note: "Uses the @lottiefiles/dotlottie-web package with a <canvas> element.",
    code: `// npm install @lottiefiles/dotlottie-web\nimport { DotLottie } from "@lottiefiles/dotlottie-web";\n\n// <canvas id="canvas" width="300" height="300"></canvas>\nnew DotLottie({\n  canvas: document.getElementById("canvas"),\n  src: "${path}",\n  loop: true,\n  autoplay: true,\n});`,
  }, {
    id: "dotlottie-react", label: "React — dotLottie React", lang: "jsx", note: "Uses the @lottiefiles/dotlottie-react package.",
    code: `// npm install @lottiefiles/dotlottie-react\nimport { DotLottieReact } from "@lottiefiles/dotlottie-react";\n\nexport function Animation() {\n  return <DotLottieReact src="${path}" loop autoplay />;\n}`,
  }];
}

export function openSnippets(asset, version) {
  let format = version.format;
  const out = h("div", { class: "stack" });
  const draw = () => {
    const name = `${safeName(asset.name)}-v${version.n}.${format === "lottie" ? "lottie" : "json"}`;
    out.replaceChildren(
      h("div", { class: "row" }, h("span", { class: "muted" }, "File format"), segmented([["json", ".json"], ["lottie", ".lottie"]], format, (v) => { format = v; draw(); }, "File format")),
      bannerEl("info", "Reference examples", `Host “${name}” in your project and point the path at it. The path below is an example. This tool doesn’t run these snippets or test playback in any runtime, so check the library’s own documentation for the version you use.`),
      ...snippetsFor(name, format).map((s) => h("div", { class: "stack", style: { gap: "6px" } },
        h("div", { class: "row" }, h("b", {}, s.label), h("span", { class: "muted grow" }, s.note), h("button", { class: "btn tint sm", type: "button", onclick: async () => { try { await navigator.clipboard.writeText(s.code); toast("Snippet copied"); } catch { toast("Couldn’t copy", "error"); } } }, icon("copy"), "Copy")),
        h("pre", { class: "mono", style: { margin: 0, padding: "12px 14px", background: "var(--f3)", borderRadius: "10px", overflow: "auto", fontSize: "12.5px", lineHeight: 1.5 } }, h("code", {}, s.code)))));
  };
  draw();
  modal({ title: "Implementation snippets", subtitle: `${asset.name} · version ${version.n}`, wide: true, body: out, buttons: [{ label: "Done", kind: "fill" }] });
}
