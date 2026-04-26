import * as gesel from "./node_modules/gesel/src/index.js";

const proxy = "https://cors-proxy.aaron-lun.workers.dev";
const ref_url = "https://github.com/gesel-inc/feedstock/releases/download/indices-v0.3.0";
const gene_url = "https://github.com/gesel-inc/feedstock/releases/download/genes-v0.3.0";
const ref_key = ref_url.substr(ref_url.lastIndexOf("/") + 1);
const gene_key = gene_url.substr(gene_url.lastIndexOf("/") + 1);

async function getFile(url, key, file) {
    const cache = await caches.open(key);
    const address = proxy + "/" + encodeURIComponent(url + "/" + file);

    let existing = await cache.match(address);
    if (typeof existing == "undefined") {
        existing = await fetch(address); 
        cache.put(address, existing.clone());
    }

    if (!existing.ok) {
        throw new Error("failed to request '" + file + "' (status " + String(existing.status) + ")");
    }
    return existing.arrayBuffer();
}

const config = gesel.newConfig(
    /* fetchGeneFile = */ file => getFile(gene_url, gene_key, file),
    /* fetchDatabaseFile = */ file => getFile(ref_url, ref_key, file),
    /* fetchDatabaseRanges = */ async (file, start, end) => {
        let address = proxy + "/" + encodeURIComponent(ref_url + "/" + file);
        const everything = [];
        // GitHub doesn't support multi-range requests, but if it did, we could use that instead.
        for (var i = 0; i < start.length; i++) {
            const resp = fetch(full_url, { headers: { Range: "bytes=" + String(start[i]) + "-" + String(end[i] - 1) } })
                .then(
                    res => {
                        if (!res.ok) {
                            throw new Error("failed to fetch range from '" + file + "' (status " + String(res.status) + ")");
                        }
                        return res.arrayBuffer();
                    }
                );
            everything.push(resp);
        }
        return await Promise.all(everything);
    }
);

const precomputed = { "species ": null, "chosen_genes": null };

/*****************************************************/

async function checkCollections() {
    const all_species = document.getElementById("species-list").childNodes;
    let chosen_species = null; 
    for (const node of all_species) {
        if (node.nodeName == "INPUT" && node.getAttribute("name") == "species" && node.checked) {
            chosen_species = node.getAttribute("value");
            break;
        }
    }

    if (chosen_species == null || precomputed.species == chosen_species) {
        return true;
    }

    const all_collections = await gesel.fetchAllCollections(chosen_species, config);

    let collection_elements = [];
    for (let i = 0; i < all_collections.length; i++) {
        const check = document.createElement("input");
        check.setAttribute("type", "checkbox");
        const id = "collection-" + String(i);
        check.setAttribute("id", id);
        check.setAttribute("name", "filter-collections");
        check.setAttribute("value", String(i));
        check.setAttribute("checked", "");
        collection_elements.push(check);

        const lab = document.createElement("label");
        lab.setAttribute("for", id);
        lab.innerText = all_collections[i].title;
        collection_elements.push(lab);

        collection_elements.push(document.createElement("br"));
    }

    const coldiv = document.getElementById("collection-availability");
    coldiv.replaceChildren(...collection_elements);
    precomputed.species = chosen_species;

    return true;
}

checkCollections();

window.checkCollections = checkCollections;

/*****************************************************/

async function sanitizeGenes() { 
    const gene_el = document.getElementById("filter-genes");
    const gene_text = gene_el.value;
    if (gene_text == "") {
        precomputed.genes = null;
        return;
    }

    var lines = gene_text.split("\n");
    let indices = [];
    let queries = [];
    for (let i = 0; i < lines.length; i++) {
        var x = lines[i];
        x = x.replace(/#.*/, "");
        x = x.trim();
        if (x !== "") {
            indices.push(i);
            queries.push(x);
        }
    }

    if (queries.length == 0) {
        precomputed.genes = null;
        return;
    }

    var gene_info = await gesel.searchGenes(precomputed.species, queries, config);
    let genes = [];
    const failmsg = " # ❌ no matching gene found 😢"

    for (let i = 0; i < gene_info.length; i++) {
        let x = gene_info[i];
        if (x.length === 0) {
            const curline = lines[indices[i]];
            if (!curline.endsWith(failmsg)) {
                lines[indices[i]] += failmsg;
            }
        } else {
            for (const y of x) {
                genes.push(y);
            }
        }
    }

    gene_el.value = lines.join("\n");
    precomputed.genes = genes;
    console.log(genes);
}

window.sanitizeGenes = sanitizeGenes;

