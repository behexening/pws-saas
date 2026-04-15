To explain exactly how I want the geometry to function and render, I will use a simple example here.

Imagine you are given a polygon defined by a set of points in sequence. this polygon represents a body of water. For this example we will be using a parabola that is a part of a larger polygon. 

This parabola has the following coordinates that define it
x1,y1
-7,4.9
-6.5,4.225
-6,3.6
-5.5,3.025
-5,2.5
-4.5,2.025
-4,1.6
-3.5,1.225
-3,0.9
-2.5,0.625
-2,0.4
-1.5,0.225
-1,0.1
-0.5,0.025
0,0
0.5,0.025
1,0.1
1.5,0.225
2,0.4
2.5,0.625
3,0.9
3.5,1.225
4,1.6
4.5,2.025
5,2.5
5.5,3.025
6,3.6
6.5,4.225
7,4.9

Now imagine an announcement for this bay comes out, it says "waters south of a line defined as a line created by the following two coordinates (-3.90388,\ 1.52403), (6.40388,\ 4.10097) will be closed"

So the geometry should be edited so that all the points (locally, as in sequentially, not globally) will be removed, and that the resultant list of coordinates with the correct view would look like
x1,y1
-7,4.9
-6.5,4.225
-6,3.6
-5.5,3.025
-5,2.5
-4.5,2.025
-4,1.6
6.5,4.225
7,4.9

this is a crude example, but HOPEFULLY you should finally get it now.

Other examples can be extrapolated from the relevant wording, (NWSE will determine which "affinity" it will have to determining cut points)
Also, while in this scenario I did trim the line to the closest point of the parabola, it should never "invent" open space. It should always go to closest value less than or equal to it, never over.