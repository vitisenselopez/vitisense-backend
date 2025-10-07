import * as dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { OpenAIEmbeddings } from "@langchain/openai";
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";

dotenv.config();

const docsPath = path.join(process.cwd(), "docs");
const vectorStorePath = path.join(process.cwd(), "vectorstore");

async function run() {
  const files = fs.readdirSync(docsPath);
  const allDocs = [];

  for (const file of files) {
    if (file.endsWith(".pdf")) {
      const loader = new PDFLoader(path.join(docsPath, file));
      const docs = await loader.load();
      allDocs.push(...docs);
    }
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });

  const splitDocs = await splitter.splitDocuments(allDocs);

  const vectorStore = await HNSWLib.fromDocuments(splitDocs, new OpenAIEmbeddings());

  // Guardar en disco
  await vectorStore.save(vectorStorePath);

  console.log("✅ Ingesta completada. Documentos cargados:", splitDocs.length);
}

run().catch(console.error);