import {create, Data, insert, load, save, search} from "@lyrasearch/lyra";
import {stemmer} from "@lyrasearch/lyra/dist/cjs/stemmer/lib/ru.js";
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

function compressBrotli() {
    console.time("brotli");
    // Creating readable Stream
    const inp = fs.createReadStream(jsonFile);

    // Creating writable stream
    const out = fs.createWriteStream(jsonFile + ".brotli");

    // Calling createBrotliCompress method
    const brot = zlib.createBrotliCompress();

    brot.on("data", (chunk) => console.timeLog("brotli", chunk.length))
    // Piping
    return new Promise((resolve, reject) => {
        inp.pipe(brot)
            .pipe(out)
            .on("close", () => {
                console.timeEnd("brotli");
                resolve({});
            })
            .on("error", (err) => {
                console.error(err)
                reject(err)
            })
    })
}

async function compressGzip() {
    console.time("gz");
    // Creating readable Stream
    const inp = fs.createReadStream(jsonFile);

    // Creating writable stream
    const out = fs.createWriteStream(jsonFile + ".gz");

    // Calling createGzip method
    const gz = zlib.createGzip();

    // Piping
    return new Promise((resolve, reject) => {
        inp.pipe(gz)
            .pipe(out)
            .on("close", () => {
                console.timeEnd("gz");
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

async function loadBrotli() {
    console.time("loadBrotli");
    const brotli = zlib.createBrotliDecompress();
    const inp = fs.createReadStream(jsonFile + ".brotli");
    inp.pipe(brotli);
    const chunks = []
    for await (let chunk of brotli) {
        chunks.push(chunk)
    }
    const data = JSON.parse(Buffer.concat(chunks).toString())
    load(db, data);
    console.timeEnd("loadBrotli");
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
    console.time("parse")
    const {value: data} = parse(fs.readFileSync(jsonFile))
    console.timeEnd("parse")
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


async function loadMessagePack() {
    console.time("loadMessagePack");
    console.time("parse")
    const data = decode(fs.readFileSync(jsonFile + ".mp")) as Data<{ joke: "string" }>;
    console.timeEnd("parse")
    load(db, data);

    console.timeEnd("loadMessagePack");
}

// await index();
// serialize();
// await compressBrotli();
// await compressGzip();
// await loadBrotli();
await loadRaw();
// await serializeProto()
// await loadProto()
// await loadGzip();
console.log(search(db, {
    term: "Иваныч",
    properties: ["joke"],
}))
