async function expandLayerContents(page){
 const collapsed=page.locator('#layer-list .layer-row[data-kind="layer"] [data-action="collapse"][aria-expanded="false"]:visible');
 while(await collapsed.count())await collapsed.first().click();
}

module.exports={expandLayerContents};
