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
            const resp = fetch(address, { headers: { Range: "bytes=" + String(start[i]) + "-" + String(end[i] - 1) } })
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

const precomputed = { "species": null, "genes": null, "raw_genes": null };

/*****************************************************/

function getSpecies() {
    const all_species = document.getElementById("species-list").childNodes;
    for (const node of all_species) {
        if (node.nodeName == "INPUT" && node.getAttribute("name") == "species" && node.checked) {
            return node.getAttribute("value");
        }
    }
    return null;
}

function setSpecies(species) {
    const previous = precomputed.species;
    precomputed.species = species;
    return previous;
}

async function updateCollections() {
    const chosen_species = precomputed.species;
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

setSpecies(getSpecies());
updateCollections();

window.getSpecies = getSpecies;
window.setSpecies = setSpecies;
window.updateCollections = updateCollections;

/*****************************************************/

async function sanitizeGenes() { 
    const gene_el = document.getElementById("filter-genes");
    const gene_text = gene_el.value;
    if (gene_text == precomputed.raw_genes) {
        return;
    }
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
}

window.sanitizeGenes = sanitizeGenes;

/*****************************************************/

async function formatTable(species, results, start, end) {
    const tab = document.createElement("table");
    const actual_start = Math.min(start, results.length);
    const actual_end = Math.min(end, results.length);

    const header = document.createElement("tr");
    const colnames = ["Name", "Description", "Collection", "Size", "Overlap", "p-value"];
    for (const c of colnames) {
        const element = document.createElement("th");
        element.textContent = c;
        header.appendChild(element);
    }
    tab.appendChild(header);

    const sinfo = await gesel.fetchAllSets(species, config);
    const cinfo = await gesel.fetchAllCollections(species, config);

    for (var i = actual_start; i < actual_end; i++) {
        const currow = document.createElement("tr");
        const curres = results[i];
        const set = sinfo[curres.id];

        currow.appendChild((() => {
            const element = document.createElement("td");
            element.textContent = set.name;
            return element;
        })());

        currow.appendChild((() => {
            const element = document.createElement("td");
            element.textContent = set.description;
            return element;
        })());

        currow.appendChild((() => {
            const element = document.createElement("td");
            element.textContent = cinfo[set.collection].title;
            return element;
        })());

        currow.appendChild((() => {
            const element = document.createElement("td");
            element.textContent = set.size;
            return element;
        })());

        if ("count" in curres) {
            currow.appendChild((() => {
                const element = document.createElement("td");
                element.textContent = curres.count;
                return element;
            })());

            currow.appendChild((() => {
                const element = document.createElement("td");
                element.textContent = curres.pvalue;
                return element;
            })());
        } else {
            currow.appendChild((() => {
                const element = document.createElement("td");
                element.textContent = "n/a";
                return element;
            })());

            currow.appendChild((() => {
                const element = document.createElement("td");
                element.textContent = "n/a";
                return element;
            })());
        }

        tab.appendChild(currow);
    }

    document.getElementById("tab").replaceChildren(tab);
}

async function performSearch() { 
    const species = precomputed.species;

    await sanitizeGenes(); // just in case someone clicks on search before the event listener fired.
    let res = null;
    if (precomputed.genes !== null) {
        res = await gesel.findOverlappingSets(species, precomputed.genes, config, { includeSize: true });
        let ngenes = await gesel.effectiveNumberOfGenes(species, config);
        res.sort((left, right) => left.pvalue - right.pvalue);
    }

    const txt_filter = document.getElementById("filter-text").value;
    if (txt_filter.match(/[\w]+/)) {
        let desc_matches = await gesel.searchSetText(species, txt_filter, config);
        if (res == null) {
            let sizes = await gesel.fetchSetSizes(species, config);
            res = [];
            for (const i of desc_matches) {
                res.push({ id: i, size: sizes[i] });
            }
        } else {
            let replacement = [];
            let allowed = new Set(desc_matches);
            for (const x of res) {
                if (allowed.has(x.id)) {
                    replacement.push(x);
                }
            }
            res = replacement;
        }
    }

    const collection_nodes = document.getElementById("collection-availability").childNodes;
    const collections_to_use = new Set;
    let needs_filter = false;
    for (const child of collection_nodes) {
        if (child.nodeName == "INPUT" && child.name == "filter-collections") {
            if (child.checked) {
                collections_to_use.add(Number(child.value));
            } else {
                needs_filter = true;
            }
        }
    }

    if (needs_filter) {
        const sinfo = await gesel.fetchAllSets(species, config);
        res = res.filter(x => collections_to_use.has(sinfo[x.id].collection));
    }

    if (res === null) {
        // Probably should emit an alert or something if no search filters are set.
        res = [];
    }

    formatTable(species, res, 0, 50);
    return false;
}

window.performSearch = performSearch;
