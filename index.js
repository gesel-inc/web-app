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

const precomputed = { "species": null, "genes": null, "raw_genes": null, "results": null, "page": null };

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
        precomputed.raw_genes = gene_text;
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
        precomputed.raw_genes = gene_text;
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

    // Only update 'precomputed' right before returning, and make sure to update both 'genes' and 'raw_genes' at once.
    // If they are separated by an async operation, other concurrently running functions might be interleaved.
    // Then we'd get weird inconsistencies. 
    precomputed.genes = genes;
    precomputed.raw_genes = gene_text;
    return;
}

window.sanitizeGenes = sanitizeGenes;

/*****************************************************/

const pageSize = 50;

async function formatTable(species, results, start, end) {
    const tab = document.createElement("table");
    const actual_start = Math.min(start, results.length);
    const actual_end = Math.min(end, results.length);

    const header = document.createElement("tr");
    const colnames = ["Name", "Description", "Collection", "Size", "Overlap", "p-value", ""];
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
        currow.id = "result-row-" + String(i);
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

        currow.appendChild((() => {
            const element = document.createElement("td");
            const button = document.createElement("button");
            button.id = "show-details-" + String(i);
            button.textContent = "show details";
            button.setAttribute("onclick", "showGeneSetDetails(" + String(i) + ");");
            element.appendChild(button);
            return element;
        })());

        tab.appendChild(currow);
    }

    document.getElementById("tab").replaceChildren(tab);
}

function createPageLinks(num_results, current_page, page_size) {
    let num_pages = Math.ceil(num_results / page_size);

    const maxgap = 3;
    const to_show = new Set;

    // Adding the extremes.
    {
        const limit = Math.min(num_pages, 3);
        for (var i = 0; i < limit; ++i) {
            to_show.add(i);
            to_show.add(num_pages - i - 1);
        }
    }

    // Adding the neighbors.
    {
        const limit = Math.min(num_pages, current_page + 2);
        for (var i = Math.max(current_page - 1, 0); i < limit; i++) {
            to_show.add(i);
        }
    }

    const to_show_list = Array.from(to_show);
    to_show_list.sort((a, b) => a - b);
    const pages_list = [0];

    // Filling in the gaps so avoid unnecessary truncations.
    if (to_show_list.length) {
        for (var i = 1; i < to_show_list.length; i++) {
            const current = to_show_list[i];
            const previous = to_show_list[i - 1];
            if (current == previous + 1) {
                pages_list.push(current);
            } else if (current <= previous + 3) {
                for (var j = previous + 1; j <= current; j++) {
                    pages_list.push(j);
                }
            } else {
                pages_list.push(null); // gap indicator.
                pages_list.push(current);
            }
        }
    }

    // Creating DOM elements.
    for (var i = 0; i < pages_list.length; i++) {
        if (pages_list[i] == null) {
            pages_list[i] = "...";
        } else if (pages_list[i] === current_page) {
            const current = document.createElement("button");
            current.textContent = String(pages_list[i] + 1);
            current.setAttribute("disabled", true);
            pages_list[i] = current;
        } else {
            const current = document.createElement("button");
            current.textContent = String(pages_list[i] + 1);
            current.setAttribute("onclick", "updatePage(" + String(pages_list[i]) + ");");
            pages_list[i] = current;
        }
    }

    const ptitle = document.createElement("strong");
    ptitle.textContent = "Pages:";
    document.getElementById("pages").replaceChildren(ptitle, ...pages_list);
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

    formatTable(species, res, 0, pageSize);
    createPageLinks(res.length, 0, pageSize);
    precomputed.results = res;
    precomputed.page = 0;
    return false;
}

async function updatePage(new_page) {
    const species = precomputed.species;
    const res = precomputed.results;
    await formatTable(species, res, pageSize * new_page, pageSize * (new_page + 1));
    createPageLinks(res.length, new_page, pageSize);
    precomputed.page = new_page;
    return false;
}

window.performSearch = performSearch;
window.updatePage = updatePage;

/*****************************************************/

async function showGeneSetDetails(index) {
    const row = document.createElement("tr");
    row.id = "result-row-expanded-" + String(index);
    const entry = document.createElement("td");
    entry.setAttribute("colspan", 7);

    const species = precomputed.species;
    const res = precomputed.results[index];
    const sinfo = await gesel.fetchAllSets(species, config);
    const chosen = sinfo[res.id];
    const cinfo = await gesel.fetchAllCollections(species, config);
    const curcolle = cinfo[chosen.collection];

    // Collection details that we don't show in the table.
    entry.appendChild((function() {
        const pp = document.createElement("p");
        const st = document.createElement("strong");
        st.textContent = "Collection description:";
        pp.appendChild(st);
        pp.appendChild(document.createTextNode(curcolle.description));
        return pp;
    })());

    entry.appendChild((function() {
        const pp = document.createElement("p");
        const st = document.createElement("strong");
        st.textContent = "Collection contributor:";
        pp.appendChild(st);
        pp.appendChild(document.createTextNode(curcolle.maintainer));
        return pp;
    })());

    entry.appendChild((function() {
        const pp = document.createElement("p");
        const st = document.createElement("strong");
        st.textContent = "Collection source:";
        pp.appendChild(st);
        pp.appendChild(document.createTextNode(curcolle.source));
        return pp;
    })());

    // Adding genes.
    const membership = await gesel.fetchGenesForSomeSets(species, [res.id], config);
    const in_set = new Set(precomputed.genes);
    const inside = [];
    const outside = [];

    for (const x of membership[0]) {
        if (in_set.has(x)) {
            inside.push(x);
        } else {
            outside.push(x);
        }
    }

    res.overlapping_genes = inside;
    res.other_genes = outside;

    const choice_id = "gene-id-choice-" + String(index);
    const wrapper = document.createElement("div");
    wrapper.id = choice_id;
    wrapper.appendChild(document.createTextNode("Gene identifier type: "));

    for (const types of [["symbol", "symbol"], ["ensembl", "Ensembl"], ["entrez", "Entrez"]]) {
        const cur_choice_id = choice_id + "-" + types[0];
        wrapper.appendChild((function() {
            const choice = document.createElement("input");
            choice.type = "radio";
            choice.id = cur_choice_id;
            choice.name = choice_id;
            choice.value = types[0];
            if (types[0] == "symbol") {
                choice.setAttribute("checked", true);
            }
            return choice
        })());

        wrapper.appendChild((function() {
            const lab = document.createElement("label");
            lab.setAttribute("for", cur_choice_id);
            lab.textContent = types[1];
            return lab; 
        })());
    }

    const inside_pp = document.createElement("p");
    inside_pp.id = "overlap-genes-" + String(index);
    wrapper.appendChild(inside_pp);

    const outside_pp = document.createElement("p");
    outside_pp.id = "other-genes-" + String(index);
    wrapper.appendChild(outside_pp);

    await populate_gene_lists(species, "symbol", inside_pp, inside, outside_pp, outside);

    entry.appendChild(wrapper);
    row.appendChild(entry);
    document.getElementById("result-row-" + String(index)).after(row);

    const butt = document.getElementById("show-details-" + String(index));
    butt.textContent = "Hide details";
    butt.setAttribute("onclick", "hideGeneSetDetails(" + String(index) + ");");

    return false;
} 

async function populate_gene_lists(species, type, overlapping_node, overlapping_genes, other_node, other_genes) {
    const ids = (await gesel.fetchAllGenes(species, config, { types: [type] })).get(type);

    {
        const accumulated = [];
        for (const i of overlapping_genes) {
            const curi = ids[i];
            let entry = curi[0];
            if (curi.length > 1) {
                entry += " (" + curi.slice(1).join(", ") + ")";
            }
            accumulated.push(curi);
        }

        const st = document.createElement("strong");
        st.textContent = "Overlapping genes:";
        overlapping_node.replaceChildren(st, document.createTextNode(accumulated.join(", ")));
    }

    {
        const accumulated = [];
        for (const i of other_genes) {
            const curi = ids[i];
            let entry = curi[0];
            if (curi.length > 1) {
                entry += " (" + curi.slice(1).join(", ") + ")";
            }
            accumulated.push(curi);
        }

        const st = document.createElement("strong");
        st.textContent = "Other genes:";
        other_node.replaceChildren(st, document.createTextNode(accumulated.join(", ")));
    }
}

async function populateGeneLists(index) {
    const choice_id = "gene-id-choice-" + String(index);
    const all_choices = document.getElementById(choice_id).childNodes;
    let chosen = "symbol";
    for (const node of all_choices) {
        if (node.nodeName == "INPUT" && node.getAttribute("name") == choice_id && node.checked) {
            chosen = node.getAttribute("value");
        }
    }

    const inside_pp = document.getElementById("overlap-genes-" + String(index));
    const outside_pp = document.getElementById("other-genes-" + String(index));

    const species = precomputed.species;
    const res = precomputed.results[index];
    await populate_gene_lists(species, chosen, inside_pp, res.overlapping_genes, outside_pp, res.other_genes);
    return false;
}

function hideGeneSetDetails(index) {
    document.getElementById("result-row-expanded-" + String(index)).remove();
    const butt = document.getElementById("show-details-" + String(index));
    butt.textContent = "Show details";
    butt.setAttribute("onclick", "showGeneSetDetails(" + String(index) + ");");
}

window.showGeneSetDetails = showGeneSetDetails;
window.hideGeneSetDetails = hideGeneSetDetails;
window.populateGeneLists = populateGeneLists;
