import {create, Data, insert, load, save, search} from "@lyrasearch/lyra";
import {stemmer} from "@lyrasearch/lyra/dist/cjs/stemmer/lib/ru.js";
import {persistToFile, restoreFromFile} from '@lyrasearch/plugin-data-persistence'
import {decode, encode} from "@msgpack/msgpack";
import parse from 'fast-json-parse';
import * as fs from "fs";
import {open,} from "node:fs/promises";
import protobuf from "protobufjs";
import * as zlib from "zlib";

const db = await create({
    edge: true,
    defaultLanguage: "russian",
    schema: {
        joke: "string",
    },
    tokenizer: {
        stemmingFn: stemmer,
    },
});

async function index() {
    console.time('index');
    const startMarker = "<|startoftext|>";
    try {
        const file = await open('./data/anek.txt');
        let joke = ""
        for await (const chunk of file.readLines()) {
            if (!chunk) {
                continue
            }
            if (chunk.startsWith(startMarker)) {
                if (joke.length) {
                    insert(db, {joke});
                }
                joke = chunk.replace(startMarker, "");
            } else {
                joke += chunk;
            }
        }

        await file.close();

    } catch (e) {
        console.error(e)
    }
    console.timeEnd('index');
}

const jsonFile = "./data/index.json";

function serialize() {
    console.time('serialize');
    fs.writeFileSync(jsonFile, JSON.stringify(save(db)));
    console.timeEnd('serialize');
}

function compressBrotli(q: number) {
    const label = "brotli" + q
    console.time(label);
    // Creating readable Stream
    const inp = fs.createReadStream(jsonFile);

    // Creating writable stream
    const out = fs.createWriteStream(jsonFile + "." + label);

    // Calling createBrotliCompress method
    const brot = zlib.createBrotliCompress({
        params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: q
        }
    });

    // brot.on("data", (chunk) => console.timeLog("brotli", chunk.length))
    // Piping
    return new Promise((resolve, reject) => {
        inp.pipe(brot)
            .pipe(out)
            .on("close", () => {
                console.timeEnd(label);
                resolve({});
            })
            .on("error", (err) => {
                console.error(err)
                reject(err)
            })
    })
}

async function compressGzip(q?: number) {
    const quality = q ?? "";
    const label = "gz" + quality
    console.time(label);
    // Creating readable Stream
    const inp = fs.createReadStream(jsonFile);

    // Creating writable stream
    const out = fs.createWriteStream(jsonFile + "." + label);

    // Calling createGzip method
    const gz = zlib.createGzip({
        level: q ?? zlib.constants.Z_DEFAULT_COMPRESSION
    });

    // Piping
    return new Promise((resolve, reject) => {
        inp.pipe(gz)
            .pipe(out)
            .on("close", () => {
                console.timeEnd(label);
                inp.close();
                resolve({});
            })
            .on("error", (err) => {
                console.error(err)
                reject(err)
            })
    })
}

async function serializeProto() {
    const root = protobuf.loadSync("db.proto")

    // Obtain a message type
    var Data = root.lookupType("db.Data");

    const {value: json} = parse(fs.readFileSync(jsonFile))
    json.frequenciesMap = Object.fromEntries(
        Object.entries(json.frequencies)
            .map(([key, value]) => ([
                key, {frequencies: Object.entries(value).map(([id, data]) => ({id, data}))}
            ])));
    const data = Data.encode(json).finish();
    fs.writeFileSync(jsonFile + ".pts", data);
}

async function loadBrotli(q: number) {
    const label = "loadBrotli" + q
    console.time(label);
    const brotli = zlib.createBrotliDecompress();
    const inp = fs.createReadStream(jsonFile + ".brotli" + q);
    inp.pipe(brotli);
    const chunks = []
    for await (let chunk of brotli) {
        chunks.push(chunk)
    }
    const data = JSON.parse(Buffer.concat(chunks).toString())
    load(db, data);
    console.timeEnd(label);
}

async function loadGzip() {
    console.time("loadGzip");
    const gz = zlib.createGunzip();
    const inp = fs.createReadStream(jsonFile + ".gz");
    inp.pipe(gz);
    const chunks = []
    for await (let chunk of gz) {
        chunks.push(chunk)
    }
    console.time("parse")
    const data = JSON.parse(Buffer.concat(chunks).toString())
    console.timeEnd("parse")
    load(db, data);
    console.timeEnd("loadGzip");
}

async function loadRaw() {
    console.time("loadRaw");
    // const inp = fs.createReadStream(jsonFile);
    // const chunks = []
    // for await (let chunk of inp) {
    //     chunks.push(chunk)
    // }
    // console.time("parse")
    const {value: data} = parse(fs.readFileSync(jsonFile))
    // console.timeEnd("parse")
    load(db, data);
    console.timeEnd("loadRaw");
}

async function loadProto() {
    console.time("loadProto");
    const root = await protobuf.load("db.proto")
    // Obtain a message type
    var DataPB = root.lookupType("db.Data");

    console.time("parse")
    const data = DataPB.decode(fs.readFileSync(jsonFile + ".pts")).toJSON();
    const frequencies = {};
    for (const [key, val] of Object.entries(data.frequenciesMap)) {
        // @ts-ignore
        frequencies[key] = Object.fromEntries(val.frequencies.map(f => [f.id, f.data]))
    }

    console.timeEnd("parse")
    load(db, {
        docs: data.docs,
        frequencies: frequencies,
        index: data.index,
        nodes: data.nodes,
        schema: {joke: "string"},
        tokenOccurrencies: data.tokenOccurrencies
    });


    console.timeEnd("loadProto");
}

async function serializeMessagePack() {

    const {value: json} = parse(fs.readFileSync(jsonFile))
    console.time("serializeMessagePack");
    const data = encode(json)
    fs.writeFileSync(jsonFile + ".mp", data);
    console.timeEnd("serializeMessagePack");
}

function serializeNative(format: PersistenceFormat) {
    const {value: json} = parse(fs.readFileSync(jsonFile))
    load(db, json)
    console.time("serializeNative" + format);
    persistToFile(db, format, `./data/native.${format}`)
    console.timeEnd("serializeNative" + format);
}


async function loadMessagePack() {
    console.time("loadMessagePack");
    console.time("parse")
    const data = decode(fs.readFileSync(jsonFile + ".mp")) as Data<{ joke: "string" }>;
    console.timeEnd("parse")
    load(db, data);

    console.timeEnd("loadMessagePack");
}

type PersistenceFormat = "binary" | "dpack" | "json";

function loadNative(format: PersistenceFormat) {
    console.time("loadNative" + format);
    const restoredInstance = restoreFromFile(format, `./data/native.${format}`)
    console.timeEnd("loadNative" + format);
}

await index();
serialize();
await compressBrotli(zlib.constants.BROTLI_MIN_QUALITY);
await compressBrotli(zlib.constants.BROTLI_MAX_QUALITY);
await compressGzip();
await compressGzip(zlib.constants.Z_BEST_SPEED);
await compressGzip(zlib.constants.Z_BEST_COMPRESSION);

["binary", "dpack", "json"].forEach(f => {
    serializeNative(f as PersistenceFormat);
    loadNative(f as PersistenceFormat);
})

switch (process.argv[2]) {
    case "raw": {
        await loadRaw();
        break;
    }
    case "brotli0": {
        await loadBrotli(zlib.constants.BROTLI_MIN_QUALITY);
        break;
    }
    case "brotli11": {
        await loadBrotli(zlib.constants.BROTLI_MAX_QUALITY);
        break;
    }
    case "mp": {
        await loadMessagePack()
        break;
    }
    case "gzip": {
        await loadGzip();
        break;
    }
}


search(db, {
    term: "Иваныч",
    properties: ["joke"],
})
