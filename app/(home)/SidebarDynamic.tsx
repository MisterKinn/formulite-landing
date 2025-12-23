import dynamic from "next/dynamic";

const Sidebar = dynamic(() => import("../../components/Sidebar"), {
    ssr: false,
});

export default Sidebar;
