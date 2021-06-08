class PolyLine{
 
    constructor() {
        this.pointIndices = [];//list<int>
    }
}

class MultiPolyLine{
 
    constructor() {
        this.polyLines = [];//list<PolyLine>
        this.multiPolyID = -1;
    }
}

/**
 * The LODData class manages one level of detail.
 * - Streamlines are extracted from the streamline generator and are stored as MultiPolyLines.
 * - They are then modified (e.g. simplified)
 * - Finally they are converted and stored in a DataUnit to be used as textures
 */
class LODData{

    /**
     * 
     * @param {string} name the name of the lod data
     */
    constructor(name, p_streamline_context, gl) {
        console.log("Generate lod: "+name);
        this.name = name;
        this.vectorMultiPolyLines = [];
        this.vectorLineSegment = [];
        this.tree_nodes = [];

        //---start region: references
        this.p_streamline_context = p_streamline_context;
        this.p_streamline_generator = p_streamline_context.streamline_generator;
        this.p_raw_data = p_streamline_context.raw_data;
        this.p_lights = p_streamline_context.p_lights;
        //---end region: references

        //---start region: data unit 
        this.data_unit = new DataUnit(name);
        this.data_container_dir_lights = new DataContainer("dir_lights", new DirLight());
        this.data_container_positions = new DataContainer("positions", new PositionData());
        this.data_container_line_segments = new DataContainer("line_segments", new LineSegment());
        this.data_container_tree_nodes = new DataContainer("tree_nodes", new TreeNode());
        this.data_unit.registerDataCollection(this.data_container_dir_lights);
        this.data_unit.registerDataCollection(this.data_container_positions);
        this.data_unit.registerDataCollection(this.data_container_line_segments);
        this.data_unit.registerDataCollection(this.data_container_tree_nodes);
        //---end region: data unit 

        this.data_textures = new DataTextures(gl, this.data_unit);
    }
    
    Reset(){
        this.vectorMultiPolyLines = [];
        this.vectorLineSegment = [];  
    }

    ExtractMultiPolyLines(direction){
        console.log("ExtractMultiPolyLines");
        this.Reset();

        var multi = new MultiPolyLine();
        var poly = new PolyLine();
        var currentDirection;
        for (var seedIndex = 0; seedIndex < this.p_raw_data.num_seeds; seedIndex++)
        {
            var startIndex = seedIndex*this.p_raw_data.num_points_per_streamline;
            var oldFlag = 1337;
            for (var offset = 0; offset < this.p_raw_data.num_points_per_streamline; offset++)
            {
                var index = startIndex + offset;
                var flag = this.p_raw_data.data[index].position[3];
                switch (flag)
                {
                case -1://new polyline other direction
                    //console.log("case -1: new polyline other direction");
                    currentDirection = DIRECTION_BACKWARD;
                    poly.pointIndices.push(index);
                    break;
                case 0://skip point
                    //console.log("case 0: skip point");
                    break;
                case 1://new polyline
                    //console.log("case 1: new polyline");
                    currentDirection = DIRECTION_FORWARD;
                    poly.pointIndices.push(index);
                    break;
                case 2://normal point
                    //console.log("case 2: normal point");
                    poly.pointIndices.push(index);
                    break;
                case 3://end polyline
                    //console.log("case 3: end polyline");
                    poly.pointIndices.push(index);
                    if (poly.pointIndices.length == 1)
                    {
                        console.log("Error size 1");
                    }
                    multi.polyLines.push(poly);
                    poly = new PolyLine();;//cleanup for next poly
                    break;
                default://ERROR
                    console.log("Error unknown flag: ", flag);
                    break;
                }
                if (flag == oldFlag)
                {
                    if (flag == 3 || flag == 1 || flag == -1)
                    {
                        console.log("Error consecutive flags: ", flag);
                    }
                }
                oldFlag = flag;
            }
            if (direction != DIRECTION_BOTH || currentDirection == DIRECTION_BACKWARD)
            {
                //the multi poly line ends for every seed in "direction=forward" or "direction=backward" mode
                //in "direction=both" mode, the multi poly ends if the current direction is backward
                //because seeds alternate forward and backward
                this.vectorMultiPolyLines.push(multi);
                multi = new MultiPolyLine();
            }
        }

        for (var i = 0; i < this.vectorMultiPolyLines.length; i++)	
            this.vectorMultiPolyLines[i].multiPolyID = i;
        
        console.log("ExtractMultiPolyLines completed");
        console.log("this.vectorMultiPolyLines: ", this.vectorMultiPolyLines);
    }

    GenerateLineSegments(){
        console.log("GenerateLineSegments");
        for (var i = 0; i < this.vectorMultiPolyLines.length; i++)
        {
            var m = this.vectorMultiPolyLines[i];
            for (var j = 0; j < m.polyLines.length; j++)
            {
                var p = m.polyLines[j];
                for (var k = 1; k < p.pointIndices.length; k++)
                {
                    var segment = new LineSegment();
                    segment.indexA = p.pointIndices[k - 1];
                    segment.indexB = p.pointIndices[k];
                    segment.multiPolyID = m.multiPolyID;
                    segment.copy = 0;
                    segment.isBeginning = (k == 1) ? 1 : 0;
                    this.vectorLineSegment.push(segment);
                }
            }
        }
        console.log("GenerateLineSegments completed");
        console.log("this.vectorLineSegment [", this.vectorLineSegment.length, "]: " , this.vectorLineSegment);
    }

    CalculateMatrices(){        
        for (var i = 0; i < this.vectorLineSegment.length; i++)
        {
            var matrixTranslation = glMatrix.mat4.create();
            var matrixRotation1 = glMatrix.mat4.create();
            var matrixRotation2 = glMatrix.mat4.create();
            var matrixRotation3 = glMatrix.mat4.create();
            var matrixCombined = glMatrix.mat4.create();
            var matrixInverted = glMatrix.mat4.create();

            var posA_os = glMatrix.vec4.create();
            var posB_os = glMatrix.vec4.create();

            var translation_vector = glMatrix.vec3.create();
            var axis_x = glMatrix.vec3.fromValues(1,0,0);
            var axis_y = glMatrix.vec3.fromValues(0,1,0);

            //std::cout << "------------------------------" << i << std::endl;
            //std::cout << "SEGMENT: " << i << std::endl;
            //calculate translation matrix
            var lineSegment = this.vectorLineSegment[i];
            var indexA = lineSegment.indexA;
            var indexB = lineSegment.indexB;
            var posA_ws = this.p_raw_data.data[indexA].position;//vec4
            var posB_ws = this.p_raw_data.data[indexB].position;//vec4
            //std::cout << "posA_ws: " << posA_ws.x() << ", " << posA_ws.y() << ", " << posA_ws.z() << std::endl;
            //std::cout << "posB_ws: " << posB_ws.x() << ", " << posB_ws.y() << ", " << posB_ws.z() << std::endl;
            vec3_from_vec4(translation_vector, posA_ws);
            glMatrix.vec3.negate(translation_vector, translation_vector);
            glMatrix.mat4.fromTranslation(matrixTranslation, translation_vector);//matrixTranslation.translate(-1 * posA_ws.toVector3D());
            
            glMatrix.vec4.transformMat4(posA_os, posA_ws, matrixTranslation);//var posA_os = matrixTranslation * posA_ws;//vec4
            glMatrix.vec4.transformMat4(posB_os, posB_ws, matrixTranslation);//var posB_os = matrixTranslation * posB_ws;//vec4
            //std::cout << "posA_os: " << posA_os.x() << ", " << posA_os.y() << ", " << posA_os.z() << std::endl;
            //std::cout << "posB_os: " << posB_os.x() << ", " << posB_os.y() << ", " << posB_os.z() << std::endl;

            //calculate rotation matrix (rotate around y)
            var x = posB_os[0];
            var z = posB_os[2];
            var angle_y_rad = Math.atan2(-x, z);//angleY = (Math.atan2(-x, z)) * 180 / M_PI;
            //std::cout << "angle_y_rad: " << angle_y_rad << std::endl;
            glMatrix.mat4.fromRotation(matrixRotation1, angle_y_rad, axis_y);//matrixRotation1.rotate(angle_y_degree, QVector3D(0, 1, 0));

            //combine matrices
            glMatrix.mat4.multiply(matrixCombined, matrixRotation1, matrixTranslation);//matrixCombined = matrixRotation1 * matrixTranslation;
            glMatrix.vec4.transformMat4(posA_os, posA_ws, matrixCombined);//posA_os = matrixCombined * posA_ws;
            glMatrix.vec4.transformMat4(posB_os, posB_ws, matrixCombined);//posB_os = matrixCombined * posB_ws;
            //std::cout << "posA_os: " << posA_os.x() << ", " << posA_os.y() << ", " << posA_os.z() << std::endl;
            //std::cout << "posB_os: " << posB_os.x() << ", " << posB_os.y() << ", " << posB_os.z() << std::endl;

            //calculate rotation matrix (rotate around x)
            var y = posB_os[1];
            z = posB_os[2];
            var angle_x_rad = Math.atan2(y, z);//angleX = (Math.atan2(y, z)) * 180 / M_PI;
            //std::cout << "angle_x_rad: " << angle_x_rad << std::endl;
            glMatrix.mat4.fromRotation(matrixRotation2, angle_x_rad, axis_x);//matrixRotation2.rotate(angle_x_degree, QVector3D(1, 0, 0));

            //combine matrices
            glMatrix.mat4.multiply(matrixCombined, matrixRotation2, matrixCombined);//matrixCombined = matrixRotation2 * matrixRotation1 * matrixTranslation;
            glMatrix.vec4.transformMat4(posA_os, posA_ws, matrixCombined);//posA_os = matrixCombined * posA_ws;
            glMatrix.vec4.transformMat4(posB_os, posB_ws, matrixCombined);//posB_os = matrixCombined * posB_ws;
            //std::cout << "posA_os: " << posA_os.x() << ", " << posA_os.y() << ", " << posA_os.z() << std::endl;
            //std::cout << "posB_os: " << posB_os.x() << ", " << posB_os.y() << ", " << posB_os.z() << std::endl;

            if (posB_os[2] < posA_os[2])
            {
                glMatrix.mat4.fromRotation(matrixRotation3, Math.PI, axis_x);//rotate.rotate(180, QVector3D(1, 0, 0));
                glMatrix.mat4.multiply(matrixCombined, matrixRotation3, matrixCombined);//matrixCombined = rotate * matrixCombined;
                glMatrix.vec4.transformMat4(posA_os, posA_ws, matrixCombined);//posA_os = matrixCombined * posA_ws;
                glMatrix.vec4.transformMat4(posB_os, posB_ws, matrixCombined);//posB_os = matrixCombined * posB_ws;
                //std::cout << "posA_os: " << posA_os.x() << ", " << posA_os.y() << ", " << posA_os.z() << std::endl;
                //std::cout << "posB_os: " << posB_os.x() << ", " << posB_os.y() << ", " << posB_os.z() << std::endl;
            }
            
            glMatrix.mat4.invert(matrixInverted, matrixCombined);//matrixInverted = matrixCombined.inverted();

            this.vectorLineSegment[i].matrix = matrixCombined;
            this.vectorLineSegment[i].matrix_inv = matrixInverted;
            //console.log("posA_os: ", posA_os);
            //console.log("posB_os: ", posB_os);
        }        
    }

    CalculateBVH(){
        console.log("CalculateBVH");
        var bvh = new BVH_AA();        
        var tubeRadius = 0.005;
        var maxCost = -1;
        var growthID = -1;
        var volume_threshold = 0.0001;
        bvh.GenerateTree(this.p_raw_data.data, this.vectorLineSegment, tubeRadius, maxCost, growthID, volume_threshold);
        this.tree_nodes = bvh.ConvertNodes();
        console.log("tree_nodes: "+this.tree_nodes);
        console.log("CalculateBVH completed");
    }

    UpdateDataUnit(){
        console.log("UpdateDataUnit");
        this.data_container_dir_lights.data = this.p_lights.dir_lights;
        this.data_container_positions.data = this.p_raw_data.position_data;
        this.data_container_line_segments.data = this.vectorLineSegment;
        this.data_container_tree_nodes.data = this.tree_nodes;
        this.data_unit.generateArrays();
        console.log("UpdateDataUnit completed");
    }

    UpdateDataTextures(gl){
        console.log("UpdateDataTextures");
        this.data_textures.update(gl);
        console.log("UpdateDataTextures completed");
    }

    bind(gl, shader_uniforms, location_texture_float, location_texture_int){
        gl.activeTexture(gl.TEXTURE0);                  // added this and following line to be extra sure which texture is being used...
        gl.bindTexture(gl.TEXTURE_3D, this.data_textures.texture_float.texture);
        gl.uniform1i(location_texture_float, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_3D, this.data_textures.texture_int.texture);
        gl.uniform1i(location_texture_int, 1);

        shader_uniforms.setUniform("start_index_int_position_data", this.data_unit.getIntStart("positions"));
        shader_uniforms.setUniform("start_index_int_line_segments", this.data_unit.getIntStart("line_segments"));
        shader_uniforms.setUniform("start_index_int_tree_nodes", this.data_unit.getIntStart("tree_nodes"));
        shader_uniforms.setUniform("start_index_int_dir_lights", this.data_unit.getIntStart("dir_lights"));
        shader_uniforms.setUniform("start_index_float_position_data", this.data_unit.getFloatStart("positions"));
        shader_uniforms.setUniform("start_index_float_line_segments", this.data_unit.getFloatStart("line_segments"));
        shader_uniforms.setUniform("start_index_float_tree_nodes", this.data_unit.getFloatStart("tree_nodes"));
        shader_uniforms.setUniform("start_index_float_dir_lights", this.data_unit.getFloatStart("dir_lights"));
        shader_uniforms.updateUniforms();
    }
}