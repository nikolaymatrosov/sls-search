import {IamServiceAccount} from "@yc/iam-service-account";
import {IamServiceAccountStaticAccessKey} from "@yc/iam-service-account-static-access-key";
import {YandexProvider} from "@yc/provider";
import {ResourcemanagerFolderIamBinding} from "@yc/resourcemanager-folder-iam-binding";
import {StorageBucket} from "@yc/storage-bucket";
import {StorageObject} from "@yc/storage-object";
import {App, TerraformStack} from "cdktf";
import {Construct} from "constructs";
import * as fs from "fs";
import * as path from "path";
import {NodeFunction} from "./lib/NodeFunction";
import {getCdkRoot} from "./lib/utils";

class MyStack extends TerraformStack {
    constructor(scope: Construct, id: string) {
        super(scope, id);
        const folderId = process.env.FOLDER_ID as string;

        new YandexProvider(this, "yandex", {
            serviceAccountKeyFile: fs.readFileSync("./key.json").toString(),
            folderId,
        })

        const sa = new IamServiceAccount(this, "bucket-creator", {name: "bucket-creator"});

        new ResourcemanagerFolderIamBinding(this, "bucket-editor", {
            members: [`serviceAccount:${sa.id}`],
            folderId,
            role: 'storage.editor',
            sleepAfter: 15,
        })

        const staticAccessKey = new IamServiceAccountStaticAccessKey(this, "bucket-creator-key", {serviceAccountId: sa.id})


        const fnSA = new IamServiceAccount(this, "fn-sa", {name: "fn-sa"});

        const roles = [
            "storage.viewer",
        ]
        roles.forEach((role, index) => {
            new ResourcemanagerFolderIamBinding(this, `sa-roles-${index}`, {
                members: [`serviceAccount:${fnSA.id}`],
                folderId,
                role
            });
        });
        const bucket = "sls-search";
        new StorageBucket(
            this,
            "search-bucket",
            {
                bucket,
                accessKey: staticAccessKey.accessKey,
                secretKey: staticAccessKey.secretKey,
            }
        )

        const index = new StorageObject(
            this,
            "serialized-index",
            {
                bucket,
                key: "index",
                accessKey: staticAccessKey.accessKey,
                secretKey: staticAccessKey.secretKey,
                source: path.resolve(getCdkRoot(), '../data/index.json.gz'),
            }
        )

        new NodeFunction(
            this,
            "search",
            {
                entrypoint: "search.handler",
                name: "search",
                path: "../build",
                executionTimeout: "15",
                memory: 2048,
                serviceAccountId: fnSA.id,
                environment: {
                    AWS_ACCESS_KEY_ID: staticAccessKey.accessKey,
                    AWS_SECRET_ACCESS_KEY: staticAccessKey.secretKey,
                    NODE_OPTIONS: "--max-old-space-size=2048",
                    YCF_NO_RUNTIME_POOL: "1"
                },
                dependsOn: [index]
            }
        )

    }
}

const app = new App();
new MyStack(app, "tfcdk-sls");
app.synth();
