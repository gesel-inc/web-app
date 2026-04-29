import * as gesel from "./gesel/src/index.js";

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
        if (!existing.ok) {
            throw new Error("failed to request '" + file + "' (status " + String(existing.status) + ")");
        }
        cache.put(address, existing.clone());
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
            const resp = fetch(address + "?start=" + String(start[i]) + "&end=" + String(end[i] - 1))
                .then(
                    res => {
                        if (res.status != 206) {
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

async function setSpecies(chosen_species) {
    if (precomputed.species == chosen_species) {
        return;
    }

    const button = document.getElementById("search");
    const is_disabled = button.getAttribute("disabled");
    let old_html = button.innerHTML;
    if (!is_disabled) {
        button.innerHTML = "Updating to chosen species <span class=\"loader\"></span>";
        button.setAttribute("disabled", true);
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

        const lab = document.createElement("label");
        lab.setAttribute("for", id);
        lab.innerText = all_collections[i].title;

        const box = document.createElement("div");
        box.setAttribute("class", "collection-" + (i % 2 == 0 ? "even" : "odd"));
        box.replaceChildren(check, lab);
        collection_elements.push(box);
    }

    const coldiv = document.getElementById("collection-availability");
    coldiv.replaceChildren(...collection_elements);

    // Also sanitizing the genes, if anything was there.
    await sanitizeGenes();

    precomputed.species = chosen_species;
    if (!is_disabled) {
        button.innerHTML = old_html;
        button.removeAttribute("disabled");
    }

    return false;
}

setSpecies("9606");

window.setSpecies = setSpecies;

/*****************************************************/

async function sanitizeGenesRaw() { 
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
    const okmsg = " # ✅ gene found 😄"

    for (let i = 0; i < gene_info.length; i++) {
        let x = gene_info[i];
        let curline = lines[indices[i]];

        if (x.length === 0) {
            if (!curline.endsWith(failmsg)) {
                if (curline.endsWith(okmsg)) {
                    curline = curline.slice(0, curline.length - okmsg.length);
                }
                lines[indices[i]] = curline + failmsg;
            }
        } else {
            if (!curline.endsWith(okmsg)) {
                if (curline.endsWith(failmsg)) {
                    curline = curline.slice(0, curline.length - failmsg.length);
                }
                lines[indices[i]] = curline + okmsg;
            }
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

async function sanitizeGenes() {
    const s_button = document.getElementById("search");
    const is_s_disabled = s_button.getAttribute("disabled");
    const old_s_html = s_button.innerHTML;
    if (!is_s_disabled) {
        s_button.innerHTML = "<em>Validating genes</em> <span class=\"loader\"></span>";
        s_button.setAttribute("disabled", true);
    }

    const v_button = document.getElementById("validate-genes");
    const is_v_disabled = v_button.getAttribute("disabled");
    const old_v_html = v_button.innerHTML;
    if (!is_v_disabled) {
        v_button.innerHTML = "<em>Validating</em> <span class=\"loader\"></span>";
        v_button.setAttribute("disabled", true);
    }

    await sanitizeGenesRaw();

    if (!is_v_disabled) {
        v_button.innerHTML = old_v_html;
        v_button.removeAttribute("disabled");
    }

    if (!is_s_disabled) {
        s_button.innerHTML = old_s_html;
        s_button.removeAttribute("disabled");
    }

    return false;
}

window.sanitizeGenes = sanitizeGenes;

/*****************************************************/

const pageSize = 50;

async function formatTable(species, results, start, end) {
    const tab = document.createElement("table");
    tab.setAttribute("class", "result-table");
    const actual_start = Math.min(start, results.length);
    const actual_end = Math.min(end, results.length);

    const thead = document.createElement("thead");
    const header = document.createElement("tr");
    const colnames = ["Name", "Description", "Collection", "Size", "Overlap", "p-value", ""];
    const colwidths = [ 20, 30, 20, 5, 5, 10, 10 ];
    for (var c = 0; c < colnames.length; c++) {
        const element = document.createElement("th");
        element.textContent = colnames[c];
    
        let style = "width: " + String(colwidths[c]) + "%; ";
        if (colnames[c] == "Name") {
            style += "border-radius: 0.25rem 0rem 0rem 0rem";
        }
        if (colnames[c] == "p-value") {
            style += "border-radius: 0rem 0.25rem 0rem 0rem";
        }
        element.setAttribute("style", style);

        if (colnames[c] != "") {
            element.setAttribute("class", "result-header");
        }
        header.appendChild(element);
    }

    thead.appendChild(header);
    tab.appendChild(thead);

    const sinfo = await gesel.fetchAllSets(species, config);
    const cinfo = await gesel.fetchAllCollections(species, config);

    const tbody = document.createElement("tbody");
    for (var i = actual_start; i < actual_end; i++) {
        const currow = document.createElement("tr");
        currow.id = "result-row-" + String(i);
        const curres = results[i];
        const set = sinfo[curres.id];

        // We don't use nth-of-type because we want to preserve the colors
        // even after inserting rows with the expanded information.
        const cell_class = "result-cell-" + (i % 2 == 0 ? "even" : "odd");

        currow.appendChild((() => {
            const element = document.createElement("td");
            element.textContent = set.name;
            element.setAttribute("class", cell_class);
            return element;
        })());

        currow.appendChild((() => {
            const element = document.createElement("td");
            element.textContent = set.description;
            element.setAttribute("class", cell_class);
            return element;
        })());

        currow.appendChild((() => {
            const element = document.createElement("td");
            element.textContent = cinfo[set.collection].title;
            element.setAttribute("class", cell_class);
            return element;
        })());

        currow.appendChild((() => {
            const element = document.createElement("td");
            element.textContent = set.size;
            element.setAttribute("class", cell_class);
            return element;
        })());

        if ("count" in curres) {
            currow.appendChild((() => {
                const element = document.createElement("td");
                element.textContent = curres.count;
                element.setAttribute("class", cell_class);
                return element;
            })());

            currow.appendChild((() => {
                const element = document.createElement("td");
                element.textContent = curres.pvalue.toExponential(3);
                element.setAttribute("class", cell_class);
                return element;
            })());
        } else {
            currow.appendChild((() => {
                const element = document.createElement("td");
                element.textContent = "n/a";
                element.setAttribute("class", cell_class);
                return element;
            })());

            currow.appendChild((() => {
                const element = document.createElement("td");
                element.textContent = "n/a";
                element.setAttribute("class", cell_class);
                return element;
            })());
        }

        currow.appendChild((() => {
            const element = document.createElement("td");
            const button = document.createElement("button");
            button.id = "show-details-" + String(i);
            button.textContent = "Show details";
            button.setAttribute("onclick", "showGeneSetDetails(" + String(i) + ");");
            element.appendChild(button);
            return element;
        })());

        tbody.appendChild(currow);
    }

    tab.appendChild(tbody);
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
        } else {
            const current = document.createElement("button");
            current.textContent = String(pages_list[i] + 1);
            current.setAttribute("class", "pages-button");
            if (pages_list[i] === current_page) {
                current.setAttribute("disabled", true);
            } else {
                current.setAttribute("onclick", "updatePage(" + String(pages_list[i]) + ");");
            }
            pages_list[i] = current;
        }
    }

    const ptitle = document.createElement("strong");
    ptitle.textContent = "Pages:";
    document.getElementById("pages").replaceChildren(ptitle, ...pages_list);
}

function createSummary(num_results, current_page, page_size) {
    const start = Math.min(current_page * page_size + 1, num_results);
    const end = Math.min((current_page + 1) + page_size, num_results);
    const info = document.createTextNode("Currently showing results " + String(start) + " to " + String(end) + " out of " + String(num_results) + " total"); 
    document.getElementById("summary").replaceChildren(info);
}

async function performSearch() { 
    const species = precomputed.species;
    const button = document.getElementById("search");
    const is_disabled = button.getAttribute("disabled");
    if (!is_disabled) {
        button.innerHTML = "Searching <span class=\"loader\"></span>";
        button.setAttribute("disabled", true);
    }

    await sanitizeGenesRaw();
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
    createSummary(res.length, 0, pageSize);
    precomputed.results = res;
    precomputed.page = 0;

    if (!is_disabled) {
        button.innerHTML = "Search gene sets";
        button.removeAttribute("disabled");
    }

    return false;
}

async function updatePage(new_page) {
    const species = precomputed.species;
    const res = precomputed.results;
    await formatTable(species, res, pageSize * new_page, pageSize * (new_page + 1));
    createPageLinks(res.length, new_page, pageSize);
    createSummary(res.length, new_page, pageSize);
    precomputed.page = new_page;
    return false;
}

window.performSearch = performSearch;
window.updatePage = updatePage;

/*****************************************************/

async function showGeneSetDetails(index) {
    const expanded_id = "result-row-expanded-" + String(index);
    if (document.getElementById(expanded_id) !== null) {
        // Avoid creating multiple expanded rows when the user manages to press multiple times. 
        return false;
    }

    const butt = document.getElementById("show-details-" + String(index));
    const is_disabled = butt.getAttribute("disabled");
    if (!is_disabled) {
        butt.innerHTML = "Fetching <span class=\"loader\"></span>";
        butt.setAttribute("disabled", true);
    }

    const row = document.createElement("tr");
    row.id = expanded_id;
    const entry = document.createElement("td");
    entry.setAttribute("colspan", 7);
    entry.setAttribute("class", "result-expanded");

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
        st.textContent = "Collection description: ";
        pp.appendChild(st);
        pp.appendChild(document.createTextNode(curcolle.description));
        return pp;
    })());

    entry.appendChild((function() {
        const pp = document.createElement("p");
        const st = document.createElement("strong");
        st.textContent = "Collection contributor: ";
        pp.appendChild(st);
        pp.appendChild(document.createTextNode(curcolle.maintainer));
        return pp;
    })());

    entry.appendChild((function() {
        const pp = document.createElement("p");
        const st = document.createElement("strong");
        st.textContent = "Collection source: ";
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

    const wrapper = document.createElement("div");
    const choice_id = "gene-id-choice-" + String(index); 
    const st = document.createElement("label");
    st.setAttribute("for", choice_id);
    st.innerHTML = "<strong>Gene identifier type: </strong>";
    wrapper.appendChild(st);

    const selector = document.createElement("select");
    selector.id = choice_id;
    selector.setAttribute("onchange", "window.populateGeneLists(" + String(index) + ", this.value);");
    for (const types of [["symbol", "symbol"], ["ensembl", "Ensembl"], ["entrez", "Entrez"]]) {
        selector.appendChild((function() {
            const choice = document.createElement("option");
            choice.value = types[0];
            choice.textContent = types[1];
            return choice
        })());
    }
    wrapper.append(selector);

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

    if (!is_disabled) {
        butt.textContent = "Hide details";
        butt.removeAttribute("disabled");
    }
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
        st.textContent = "Overlapping genes: ";
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
        st.textContent = "Other genes: ";
        other_node.replaceChildren(st, document.createTextNode(accumulated.join(", ")));
    }
}

async function populateGeneLists(index, type) {
    const inside_pp = document.getElementById("overlap-genes-" + String(index));
    const outside_pp = document.getElementById("other-genes-" + String(index));
    const species = precomputed.species;
    const res = precomputed.results[index];
    await populate_gene_lists(species, type, inside_pp, res.overlapping_genes, outside_pp, res.other_genes);
    return false;
}

function hideGeneSetDetails(index) {
    const expanded = document.getElementById("result-row-expanded-" + String(index));
    if (expanded == null) {
        return false;
    }

    expanded.remove();
    const butt = document.getElementById("show-details-" + String(index));
    butt.textContent = "Show details";
    butt.setAttribute("onclick", "showGeneSetDetails(" + String(index) + ");");
}

window.showGeneSetDetails = showGeneSetDetails;
window.hideGeneSetDetails = hideGeneSetDetails;
window.populateGeneLists = populateGeneLists;
