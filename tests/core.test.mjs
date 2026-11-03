import test from "node:test";
import assert from "node:assert/strict";
import { readZip, writeZip, enc, dec } from "../js/core/zip.js";
import { convertJob, readAnimationFile, dotLottieToJson, jsonToDotLottie, toFormat, sniff, ConvertError, b64dec } from "../js/core/convert.js";
import { anim, withImage, bytes } from "./fixtures.mjs";

test("zip round-trips stored and deflated entries", async () => {
  const z = await writeZip([{ name: "a.txt", data: enc.encode("hello ".repeat(100)) }, { name: "b.bin", data: new Uint8Array([1, 2, 3]), store: true }]);
  const r = await readZip(z);
  assert.deepEqual(r.names(), ["a.txt", "b.bin"]);
  assert.equal(dec.decode(await r.read("a.txt")), "hello ".repeat(100));
  assert.deepEqual([...(await r.read("b.bin"))], [1, 2, 3]);
});

test("json -> .lottie v1 extracts images, and back inlines them", async () => {
  const [out] = await convertJob([{ name: "x.json", bytes: bytes(withImage()) }], { extract: true, version: "1", pretty: false });
  assert.equal(out.format, "lottie");
  const z = await readZip(out.bytes);
  assert.ok(z.has("manifest.json") && z.has("animations/x.json"));
  assert.ok(z.names().some((n) => n.startsWith("images/") && n.endsWith(".png")));
  const [back] = await convertJob([{ name: "x.lottie", bytes: out.bytes }], { inline: true });
  assert.equal(back.format, "json"); assert.equal(back.missing.length, 0);
  const a = back.anims[0][1].assets[0];
  assert.ok(a.p.startsWith("data:image/png;base64,") && a.e === 1 && a.u === "");
});

test("v2 layout uses a/ and i/", async () => {
  const [out] = await convertJob([{ name: "y.json", bytes: bytes(withImage()) }], { extract: true, version: "2" });
  const z = await readZip(out.bytes);
  assert.ok(z.has("a/y.json") && z.names().some((n) => n.startsWith("i/")));
  const { anims } = await readAnimationFile(out.bytes, { name: "y.lottie" });
  assert.ok(anims[0][1].assets[0].p.startsWith("data:"));
});

test("images are de-duplicated by content", async () => {
  const a = withImage(); a.assets.push({ ...a.assets[0], id: "image_1" });
  const z = await readZip(await jsonToDotLottie([["d", a]], { extract: true }));
  assert.equal(z.names().filter((n) => n.startsWith("images/")).length, 1);
});

test("bundle option merges several json files into one .lottie", async () => {
  const outs = await convertJob([{ name: "a.json", bytes: bytes(anim()) }, { name: "b.json", bytes: bytes(anim()) }], { bundle: true, extract: true, version: "1" });
  assert.equal(outs.length, 1); assert.equal(outs[0].name, "bundle.lottie");
  const z = await readZip(outs[0].bytes);
  assert.ok(z.has("animations/a.json") && z.has("animations/b.json"));
});

test("multi-animation .lottie yields one json per animation", async () => {
  const bytesL = await jsonToDotLottie([["one", anim()], ["two", anim()]], {});
  const outs = await convertJob([{ name: "m.lottie", bytes: bytesL }], {});
  assert.deepEqual(outs.map((o) => o.name), ["m_one.json", "m_two.json"]);
});

test("missing images are reported, not silently dropped", async () => {
  const a = anim({ assets: [{ id: "image_0", w: 1, h: 1, u: "/images/", p: "gone.png", e: 0 }] });
  const lottie = await jsonToDotLottie([["m", a]], { extract: false });
  const { anims, missing } = await readAnimationFile(lottie, { name: "m.lottie" });
  assert.deepEqual(missing, ["gone.png"]);
  assert.equal(anims[0][1].assets[0].p, "gone.png");
});

test("malformed inputs produce friendly ConvertErrors", async () => {
  await assert.rejects(() => convertJob([{ name: "bad.json", bytes: bytes("{ not json") }], {}), (e) => e instanceof ConvertError && /valid JSON/.test(e.message));
  await assert.rejects(() => convertJob([{ name: "no.json", bytes: bytes({ hello: 1 }) }], {}), /missing/);
  await assert.rejects(() => convertJob([{ name: "t.txt", bytes: bytes("plain text") }], {}), /isn't a dotLottie/);
  await assert.rejects(() => convertJob([{ name: "z.lottie", bytes: new Uint8Array([0x50, 0x4b, 1, 2, 3]) }], {}), /damaged/);
  const noManifest = await writeZip([{ name: "x.txt", data: enc.encode("x") }]);
  await assert.rejects(() => convertJob([{ name: "n.lottie", bytes: noManifest }], {}), /manifest/);
  await assert.rejects(() => convertJob([{ name: "neg.json", bytes: bytes(anim({ w: -1 })) }], {}), /positive/);
});

test("toFormat converts stored bytes and is identity for same format", async () => {
  const j = bytes(anim());
  assert.equal(await toFormat(j, "json", "json"), j);
  const l = await toFormat(j, "json", "lottie", { name: "q" });
  assert.equal(sniff(l), "lottie");
  const back = JSON.parse(dec.decode(await toFormat(l, "lottie", "json")));
  assert.equal(back.w, 200);
});

test("b64dec/inline embeds exact bytes", async () => {
  const lottie = await jsonToDotLottie([["i", withImage()]], { extract: true });
  const [[, a]] = await dotLottieToJson(lottie, { inline: true });
  assert.equal(b64dec(a.assets[0].p.split(",")[1])[0], 0x89);
});
