issues
A couple of issues I'd like to outline with both of the announcements thus far, though they are definitely the best they've been so far

For 7_19_2023pws.pdf parsed result is really close but missing a few important things
the text from the announcement in the coghill district reads as follows
The Coghill District, excluding the Bettles Bay Subdistrict and the WNH SHA inside a line of buoys in front of the barrier seine, will open to commercial drift gillnet harvest for a 36-hour period starting at 8:00 am on Thursday, July 20. Until further notice, regulatory closed waters pertaining to the Coghill River, as specified in 5 AAC 24.350(6)(B)), will not be in effect during open commercial fishing periods. Commercial fishing will not be permitted within the bed or channel of the Coghill River at any stage of the tide. The Coghill River weir has passed 47,559 sockeye salmon through 7/18 with a cumulative target of 17,440‒65,410 fish for the date. Preliminary harvest estimates from the 84-hour period that started on Thursday, July 13 were 126,000 chum, 35,400 pink, and 18,400 sockeye salmon with 498 deliveries reported.

Yet on the info card, there is no mention of the WNH SHA, nor is there any indication that the line stopped at bettles Bay, like the old issues, even though i b-boxed bettles bay, the line continues past the border of what should be considered bettles bay

And then for 8_25_2025pws.pdf, more grave issues persist. The text reads as follows

Waters of the Southwestern District, south of the latitude of 60o 11.50’ N and east of Point Helen (147o 46.27’ W.) and excluding waters of the Point Elrington and San Juan Subdistricts and waters of the AFK THA and SHA, will open to commercial purse seine fishing for a 12-hour period, from 8:00 am until 8:00 pm, on Tuesday, August 26.

there is also an image attached at the top of the second page you will have to analyze that explains it visually. For some reason the bounding closed area only represented a portion of this closed area, instead of extending all the way to the edge of the district. I think the logic should be updated to interpret these edge cases such that the order of priority in terms of removal should go like this

Districts, subdistricts, stat areas, named features, then long lat. Since the definition of the closed area was enveloped by a number of named features, I could see how it would be confusing. However, since it didnt say something like Waters of XYZ Bay north of a line of lat XYZ, it just said "waters" in general it should extend throughout the entire district. ALso, bad formatting on ADFG PArt but the same goes for valdez district in the same document. The text reads, 

Waters of the Eastern District, south of a latitude of 60o 55.10’ N, will open to commercial purse seine fishing for a 12-hour period, from 8:00 am until 8:00 pm, on Tuesday, August 26.
Waters of Valdez Arm will remain closed to minimize the incidental harvest of SGH-coho salmon.

Since the waters of valdez district are already inferred to be closed (because everything north of the mentioned line is inferred to be closed) it impairs understanding if it is mentioned twice. It's sort of irrelevant information in this case that really only trips up the parser but it is not uncommon.