import {GetObjectCommand, S3} from "@aws-sdk/client-s3";
import {create, Data, load, Lyra, search} from "@lyrasearch/lyra";
import {stemmer} from "@lyrasearch/lyra/dist/cjs/stemmer/lib/ru.js";
import {Handler} from '@yandex-cloud/function-types'
import {Stream} from "stream";
import * as zlib from "zlib";


let db: Lyra<{ joke: "string" }> | null = null;

const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

if (accessKeyId === undefined || secretAccessKey === undefined) {
    throw new Error("missing env variables")
}

const s3Client = new S3({
    forcePathStyle: false, // Configures to use subdomain/virtual calling format.
    endpoint: "https://storage.yandexcloud.net",
    region: "ru-central1",
    credentials: {
        accessKeyId,
        secretAccessKey,
    }
});

// Specifies a path within your bucket and the file to download.
const bucketParams = {
    Bucket: "sls-search",
    Key: "index"
};

// Function to turn the file's body into a string.
const streamToData = (stream: Stream): Promise<Data<{ joke: "string" }>> => {
    const chunks: any[] = [];
    const gz = zlib.createGunzip();
    stream.pipe(gz);
    console.log("pipe")
    return new Promise((resolve, reject) => {
        gz.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        gz.on('error', (err) => reject(err));
        gz.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
    });
};

// Downloads your file and saves its contents to /tmp/local-file.ext.
const loadDb = async () => {
    try {
        console.log("start loading")
        const response = await s3Client.send(new GetObjectCommand(bucketParams));
        const data = await streamToData(response.Body as Stream) as Data<{ joke: "string" }>;
        load(db!, data);
        console.log("loaded")
        return data;
    } catch (err) {
        console.log("Error", err);
    }
};

export async function loadAndSearch(term: string): Promise<object> {
    if (db === null) {
        db = await create({
            edge: true,
            defaultLanguage: "russian",
            schema: {
                joke: "string",
            },
            tokenizer: {
                stemmingFn: stemmer,
            },
        });
        await loadDb();
    }
    console.log("try to search")
    const res = search(db, {
        term,
        properties: ["joke"],
    })
    return {
        code: 200,
        body: {
            ...res,
            elapsed: `${res.elapsed}`
        }
    };
}

// @ts-ignore
export const handler: Handler.Http = async (event): Promise<object> => {
    const term = event.queryStringParameters["term"];
    return await loadAndSearch(term);
};
